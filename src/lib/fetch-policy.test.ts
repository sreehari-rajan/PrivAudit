import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractPolicyText, isPublicAddress, resolvePublicDestination, validatePolicyUrl } from "./fetch-policy.ts";

describe("public policy URL boundary", () => {
  it("rejects local, metadata, credential, port and query URLs", () => {
    for (const url of ["http://localhost/privacy", "http://127.0.0.1", "http://169.254.169.254", "http://10.0.0.1", "http://2130706433", "http://[::1]", "http://[::ffff:127.0.0.1]", "ftp://example.com", "https://user:password@example.com", "https://example.com:8080", "https://example.com/privacy?token=secret"]) {
      assert.throws(() => validatePolicyUrl(url), (error) => error instanceof Error, url);
    }
  });

  describe("policy text size boundary", () => {
    function englishText(bytes: number) {
      const sentence = "This privacy policy explains how we collect personal information and protect your rights. ";
      return sentence.repeat(Math.ceil(bytes / sentence.length)).slice(0, bytes - 1) + ".";
    }
    function html(text: string) { return `<html><body>${text}</body></html>`; }

    it("accepts policies above the old limit without truncation", () => {
      const text = englishText(32_001);
      assert.equal(extractPolicyText(html(text)), text);
    });
    it("accepts exactly 320,000 UTF-8 bytes without truncation", () => {
      const text = englishText(320_000);
      assert.equal(Buffer.byteLength(text, "utf8"), 320_000);
      assert.equal(extractPolicyText(html(text)), text);
    });
    it("rejects 320,001 bytes rather than analyzing a fragment", () => {
      const text = englishText(320_001);
      assert.equal(Buffer.byteLength(text, "utf8"), 320_001);
      assert.throws(() => extractPolicyText(html(text)), /320,000-byte analysis limit.*No partial score/);
    });
    it("measures multibyte text in UTF-8 bytes, not characters", () => {
      const accepted = englishText(319_998) + "\u00e9";
      assert.equal(Buffer.byteLength(accepted, "utf8"), 320_000);
      assert.equal(extractPolicyText(html(accepted)), accepted);
      const rejected = englishText(319_999) + "\u00e9";
      assert.equal(rejected.length, 320_000);
      assert.equal(Buffer.byteLength(rejected, "utf8"), 320_001);
      assert.throws(() => extractPolicyText(html(rejected)), /320,000-byte analysis limit/);
    });
    it("still rejects pages with too little policy text", () => {
      assert.throws(() => extractPolicyText(html("Privacy policy.")), /Not enough policy text/);
    });
  });

  describe("site chrome versus policy headers and footers", () => {
    const prose = "This privacy policy explains how we collect personal information and protect your rights. ".repeat(8);
    const page = (main: string, outside = "") => `<html><body><header><a href="/">Home</a></header>${outside}<main>${main}</main><footer><p>Copyright notice for the whole site.</p></footer></body></html>`;

    it("keeps a headed header and footer inside the main policy content", () => {
      const text = extractPolicyText(page(`<header><h1>Example Privacy Policy</h1></header><p>${prose}</p><footer><h2>Contact Us</h2><p>If you are under 13, we do not want your personal information.</p></footer>`));
      assert.match(text, /Example Privacy Policy/);
      assert.match(text, /Contact Us/);
      assert.match(text, /If you are under 13/);
    });
    it("removes page-level headers and footers", () => {
      const text = extractPolicyText(page(`<p>${prose}</p>`));
      assert.doesNotMatch(text, /Home/);
      assert.doesNotMatch(text, /Copyright notice/);
    });
    it("removes an in-content footer that is a link directory, even inside nav", () => {
      const text = extractPolicyText(page(`<p>${prose}</p><footer><h3>Learn More</h3><nav><ul><li><a href="/a">About</a></li><li><a href="/b">Blog</a></li><li><a href="/c">Careers</a></li></ul></nav><h3>About Us</h3><p>We believe in marketing claims.</p></footer>`));
      assert.doesNotMatch(text, /marketing claims/);
      assert.doesNotMatch(text, /Careers/);
    });
    it("removes an in-content header without a heading", () => {
      const text = extractPolicyText(page(`<header><button>Menu</button></header><p>${prose}</p>`));
      assert.doesNotMatch(text, /Menu/);
    });
  });

  describe("embedded policy data fallback", () => {
    const section = (title: string) => ({ title, description: `We retain your **personal data** only as described in [this policy](https://example.com/privacy) for ${title.toLowerCase()}.\n* We never sell personal data to third parties without consent.\n* You can withdraw consent and request deletion of your personal information at any time.` });
    const policy = { details: [{ description: "This Privacy Policy describes how Example Store handles personal data and cookies across our platform." }, ...["Collection", "Sharing", "Data Retention", "Your Rights"].map(section)], config: { languages: ["English", "Hindi"].map((label) => ({ label, pageTitle: "Privacy Policy" })) } };
    const offers = { home: { banner: "Get 20% Off on orders above Rs.1599 only on the app this weekend" } };
    const shell = (scripts: string, body = "<nav><a href='/men'>Men</a><a href='/women'>Women</a></nav><div>Casual Shirts</div>") => `<html><body>${body}<script>${scripts}</script></body></html>`;

    it("uses the policy from embedded assignments when the visible page has none", () => {
      const text = extractPolicyText(shell(`window["__offers__"]=${JSON.stringify(offers)};window["__page__"]=${JSON.stringify(policy)};`));
      for (const expected of ["This Privacy Policy describes how Example Store", "Data Retention", "Your Rights", "We never sell personal data"]) assert.ok(text.includes(expected), expected);
      for (const excluded of ["Get 20% Off", "Casual Shirts", "Hindi", "**", "](https", "* We never"]) assert.ok(!text.includes(excluded), excluded);
      assert.match(text, /We retain your personal data only as described in this policy for data retention\./);
    });
    it("reads JSON script tags", () => {
      const text = extractPolicyText(`<html><body><div>Loading</div><script type="application/json">${JSON.stringify(policy)}</script></body></html>`);
      assert.match(text, /Your Rights/);
    });
    it("converts HTML stored in embedded data to text", () => {
      const html = { content: `<h2>Data Retention</h2><p>${"We retain personal data and cookies only as long as necessary for the stated purposes and legal obligations. ".repeat(6)}</p>` };
      const text = extractPolicyText(shell(`var state = ${JSON.stringify(html)};`));
      assert.match(text, /^Data Retention\nWe retain personal data/);
    });
    it("prefers visible policy text over embedded data", () => {
      const prose = "This privacy policy explains how we collect personal information and protect your rights. ".repeat(8);
      const text = extractPolicyText(shell(`window["__page__"]=${JSON.stringify(policy)};`, `<main><p>${prose}</p></main>`));
      assert.match(text, /This privacy policy explains/);
      assert.doesNotMatch(text, /Example Store/);
    });
    it("still reports missing policy text when neither source has one", () => {
      assert.throws(() => extractPolicyText(shell(`window["__offers__"]=${JSON.stringify(offers)};var app = { init() { return 1; } };`)), /Not enough policy text/);
    });
  });
  it("removes fragments and accepts public URLs", () => {
    assert.equal(validatePolicyUrl("https://example.com/privacy#rights").href, "https://example.com/privacy");
  });
  it("recognizes reserved ranges and mapped IPv6 addresses", () => {
    for (const address of ["127.1.2.3", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "169.254.1.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:192.168.1.1", "192.0.2.1"]) assert.equal(isPublicAddress(address), false, address);
    assert.equal(isPublicAddress("1.1.1.1"), true);
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  });
  it("rejects mixed public/private DNS answers before connecting", async () => {
    await assert.rejects(resolvePublicDestination("example.com", async () => [{ address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }]), /private or reserved/);
  });
  it("returns only a validated public DNS destination", async () => {
    assert.deepEqual(await resolvePublicDestination("example.com", async () => [{ address: "1.1.1.1", family: 4 }]), { address: "1.1.1.1", family: 4 });
  });
});