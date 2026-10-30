/*
 * nasvip.loon.js —— 磁力宅智存 2.37 会员态改写（Loon http-response 脚本）
 *
 * 目标接口（已从二进制确认）：
 *   基址  https://xiaozhai-v1.miao2023.cc/nas_api/          (VA 0x102235a30)
 *   接口  user/get_user_status_big                          (VA 0x102226fa0)
 *   → https://xiaozhai-v1.miao2023.cc/nas_api/user/get_user_status_big
 *
 * 客户端模型 ModelUserStatus（Swift 元数据实证）字段：
 *   upload, avatar, userTag, phone, expire_date, welcomeTips,
 *   isMemeber, isSupreme, user_tags, uid, user_member,
 *   iap_pkgid_Array, cloud_note_url, album_index, album_key
 *   另有 ModelUserGrade: grade_level / grade_value / advanced_level / advanced_value
 *        UserTag 枚举    : free=0 member=1 eternal=2 supreme=3 diamond=4
 *
 * 重要：这些名字只出现在 __swift5_reflstr（反射表），代码里没有 JSON key 字面量，
 *      所以**线上真实字段名尚未确证**。本脚本因此采用「类型保持 + 名字模糊匹配」，
 *      并在首次运行时把原始 body 打到 Loon 日志，便于你据实校正 CONFIG.EXACT_* 。
 */

// ================== 配置 ==================
const CONFIG = {
  // 目标会员等级：4=diamond 3=supreme 1=member
  targetTag: 4,

  // 到期时间往后推多少天
  extendDays: 3650,

  // 首次运行打印原始响应（便于确认真实字段名），确认后设 false
  dumpOriginal: true,

  // 原始 body 打印的最大长度
  dumpLimit: 4000,

  // 如果你的实际字段名不在下面的模糊规则里，在这里精确指定（优先级最高）
  EXACT_TRUE_KEYS: [],     // 例如 ['isMember', 'is_vip']
  EXACT_FALSE_KEYS: [],    // 例如 ['expired', 'isExpired']
  EXACT_TAG_KEYS: [],      // 例如 ['userTag', 'vipType']
  EXACT_TIME_KEYS: [],     // 例如 ['expire_date', 'vipEndTime']
};

// ================== 模糊匹配规则（键名去掉 _ - 后小写比较）==================
const K_TRUE = new Set([
  'ismemeber', 'ismember', 'isvip', 'issvip', 'issupreme', 'ispremium', 'ispaid',
  'vipflag', 'memberflag', 'svipflag', 'hasvip', 'hasmember', 'hasprivilege',
]);
const K_FALSE = new Set([
  'expired', 'isexpired', 'isvipexpired', 'islimitexpired', 'istrial', 'istrying',
  'isspeedlimited', 'isviprequired', 'sviprequired', 'svipplusrequired', 'viprequired',
]);
const K_TAG = new Set([
  'usertag', 'tag', 'membertype', 'viptype', 'gradetype', 'leveltype', 'usermember',
  'memberlevel', 'viplevel', 'usergrade',
]);
const K_NUM = new Set([
  'gradelevel', 'gradevalue', 'advancedlevel', 'advancedvalue',
]);
const K_TIME = new Set([
  'expiredate', 'expiretime', 'expireat', 'vipendtime', 'vipenddate',
  'memberexpire', 'svipendtime', 'vipendedat', 'expire',
]);

// ================== 工具 ==================
const norm = (k) => String(k).replace(/[_\-]/g, '').toLowerCase();

function futureValue(original, days) {
  const ms = Date.now() + days * 86400000;
  // 类型保持：原值是数字就还数字，字符串就还字符串
  if (typeof original === 'number') {
    // 秒级时间戳通常 < 1e11；毫秒级 > 1e12
    return original > 1e11 ? Math.floor(ms / 1000) * 1000 : Math.floor(ms / 1000);
  }
  if (typeof original === 'string') {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    // 尽量沿用原来的形态
    if (/^\d+$/.test(original)) {
      return original.length >= 13 ? String(ms) : String(Math.floor(ms / 1000));
    }
    if (original.includes('T')) return d.toISOString();
    if (original.includes('-')) {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return d.toISOString();
  }
  return Math.floor(ms / 1000);
}

function tagValue(original) {
  if (typeof original === 'number') return CONFIG.targetTag;
  if (typeof original === 'string') {
    if (/^\d+$/.test(original)) return String(CONFIG.targetTag);
    return ['free', 'member', 'eternal', 'supreme', 'diamond'][CONFIG.targetTag] || 'diamond';
  }
  if (typeof original === 'boolean') return true;
  return CONFIG.targetTag;
}

function numValue(original) {
  if (typeof original === 'number') return Math.max(original, 99);
  if (typeof original === 'string' && /^\d+$/.test(original)) return '99';
  return original;
}

// ================== 递归改写 ==================
const hits = [];

function rewrite(node, path) {
  if (node === null || typeof node !== 'object') return;

  for (const key of Object.keys(node)) {
    const val = node[key];
    const p = path ? path + '.' + key : key;
    const nk = norm(key);

    // 精确优先
    if (CONFIG.EXACT_TRUE_KEYS.includes(key)) { node[key] = true; hits.push(p + '=true'); continue; }
    if (CONFIG.EXACT_FALSE_KEYS.includes(key)) { node[key] = false; hits.push(p + '=false'); continue; }
    if (CONFIG.EXACT_TAG_KEYS.includes(key)) { node[key] = tagValue(val); hits.push(p + '=tag'); continue; }
    if (CONFIG.EXACT_TIME_KEYS.includes(key)) { node[key] = futureValue(val, CONFIG.extendDays); hits.push(p + '=time'); continue; }

    if (val !== null && typeof val === 'object') { rewrite(val, p); continue; }

    if (K_TIME.has(nk)) { node[key] = futureValue(val, CONFIG.extendDays); hits.push(p + '=time'); continue; }
    if (K_TAG.has(nk)) { node[key] = tagValue(val); hits.push(p + '=tag'); continue; }
    if (K_TRUE.has(nk)) { node[key] = true; hits.push(p + '=true'); continue; }
    if (K_FALSE.has(nk)) { node[key] = false; hits.push(p + '=false'); continue; }
    if (K_NUM.has(nk)) { node[key] = numValue(val); hits.push(p + '=num'); continue; }
  }
}

// ================== 入口 ==================
(() => {
  let body = $response.body;
  if (!body || typeof body !== 'string') {
    console.log('[nasvip] 无 body，跳过');
    return $done({});
  }

  if (CONFIG.dumpOriginal) {
    console.log('[nasvip] 原始响应(', body.length, '字节):',
      body.length > CONFIG.dumpLimit ? body.slice(0, CONFIG.dumpLimit) + '…' : body);
  }

  let obj;
  try {
    obj = JSON.parse(body);
  } catch (e) {
    console.log('[nasvip] 非 JSON，跳过:', e);
    return $done({});
  }

  hits.length = 0;
  try {
    rewrite(obj, '');
  } catch (e) {
    console.log('[nasvip] 改写异常:', e);
    return $done({});
  }

  console.log('[nasvip] 命中字段:', hits.length ? hits.join(', ') : '(无 —— 请在 EXACT_* 中指定真实字段名)');

  $done({ body: JSON.stringify(obj) });
})();
