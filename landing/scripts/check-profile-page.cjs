// Locks in the behaviour of the share page for a profile that never
// finished setup. The onboarding wizard publishes the username at step 1
// but writes tags and links only on completion, so every abandoned signup
// leaves a live public page behind; before this, that page showed a name
// and an empty Follow button and nothing else - a dead end for whoever
// scanned the QR, and thin content for search engines.
//
// Drives the real handler with a stubbed fetch. No network, no database.
//   node landing/scripts/check-profile-page.cjs
const handler = require('../api/u/[username].js');

function makeFetch(profile, tags, biolinks) {
  return async (url) => {
    const u = String(url);
    const json = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => '' });
    if (u.includes('piktag_profiles?username=eq.')) return json([profile]);
    if (u.includes('piktag_biolinks')) return json(biolinks);
    if (u.includes('piktag_user_tags')) return json(tags);
    if (u.includes('piktag_asks')) return json([]);
    if (u.includes('rpc/')) return json(null);
    return json([]);
  };
}

async function render(profile, tags, biolinks, locale) {
  global.fetch = makeFetch(profile, tags, biolinks);
  let body = '', code = 0;
  const res = {
    setHeader() {}, status(c) { code = c; return this; },
    send(b) { body = b; return this; }, end() {},
  };
  await handler({ query: { username: profile.username }, headers: { 'accept-language': locale || 'zh-TW' } }, res);
  return { code, body };
}

const BASE = {
  id: '00000000-0000-4000-a000-000000000009', username: 'karlcohen.71222',
  full_name: 'Karl Cohen', avatar_url: null, bio: null, headline: null,
  is_verified: false, website: null, location: null, is_official: false,
  is_public: true, is_test_account: false, is_active: true,
};

(async () => {
  let bad = 0;
  const ck = (cond, msg) => { if (!cond) { console.log('FAIL ' + msg); bad++; } else console.log('ok   ' + msg); };

  // A. abandoned setup: no tags, no links
  const empty = await render({ ...BASE, onboarding_completed: false }, [], [], 'zh-TW');
  ck(empty.code === 200, 'A 空檔案仍回 200(不是把人擋在 404)');
  ck(empty.body.includes('這個檔案還沒設定完成'), 'A 顯示「尚未完成設定」說明');
  ck(empty.body.includes('Karl Cohen') && empty.body.includes('@karlcohen.71222'),
     'A 仍顯示名字與帳號(掃 QR 的人知道沒認錯人)');
  ck(!empty.body.includes('class="follow-btn"'), 'A 不再顯示空的追蹤鍵');
  ck(/name="robots" content="noindex/.test(empty.body), 'A robots = noindex');

  // B. same profile once it has one tag -> normal page returns by itself
  const withTag = await render({ ...BASE, onboarding_completed: false },
    [{ tag_id: 't1', piktag_tags: { name: 'coffee' } }], [], 'zh-TW');
  ck(withTag.body.includes('class="follow-btn"'), 'B 一有標籤就自動回到正常頁(追蹤鍵回來)');
  ck(!withTag.body.includes('這個檔案還沒設定完成'), 'B 不再顯示未完成說明');

  // C. links but no tags -> still a usable page, must NOT be downgraded
  const withLink = await render({ ...BASE, onboarding_completed: false }, [],
    [{ platform: 'instagram', url: 'https://instagram.com/x', label: null, position: 0 }], 'zh-TW');
  ck(withLink.body.includes('class="follow-btn"'), 'C 只有連結沒標籤 → 仍是正常頁');

  // D. English visitor gets English copy
  const en = await render({ ...BASE, onboarding_completed: false }, [], [], 'en-US');
  ck(en.body.includes("This profile isn't ready yet"), 'D 英文訪客看到英文文案');

  console.log(bad ? `\n${bad} 項失敗` : '\n全部通過');
  process.exit(bad ? 1 : 0);
})();
