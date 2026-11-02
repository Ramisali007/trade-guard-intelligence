import { sanitizeChatHtml } from './chat-html';

describe('sanitizeChatHtml', () => {
  it('keeps the markup the chat formatter makes', () => {
    const html = '<p class="ai-p">Total <strong class="ai-bold">USD 1,000</strong><br></p><ul class="ai-bullet-list"><li><span class="ai-bullet-dot"></span><div class="ai-item-content">item</div></li></ul>';
    expect(sanitizeChatHtml(html)).toBe(html);
  });

  it('keeps tables and code cards', () => {
    const html = '<div class="chat-code-card"><div class="chat-code-dots"><span class="d-red"></span></div><pre class="chat-code-pre"><code>a &lt; b</code></pre></div><table class="chat-table"><tbody><tr><td>x</td></tr></tbody></table>';
    expect(sanitizeChatHtml(html)).toBe(html);
  });

  it('removes every attribute except a known class', () => {
    const out = sanitizeChatHtml('<div class="ai-p evil-class" style="position:fixed;inset:0" id="x" onclick="steal()" data-a="1">hello</div>');
    expect(out).toBe('<div class="ai-p">hello</div>');
  });

  it('turns tags the chat does not make into plain text', () => {
    expect(sanitizeChatHtml('<img src=x onerror="alert(1)">after')).toBe('after');
    expect(sanitizeChatHtml('<a href="javascript:alert(1)">click</a>')).toBe('click');
    expect(sanitizeChatHtml('<script>alert(1)</script>safe')).toBe('safe');
    expect(sanitizeChatHtml('<iframe src="https://x"></iframe><form action="/x"><input name="p"></form>ok')).toBe('ok');
  });

  it('cannot be used to draw a lookalike overlay or badge with a class of its own', () => {
    const out = sanitizeChatHtml('<div class="modal-backdrop verified-banner">VERIFIED</div>');
    expect(out).toBe('<div>VERIFIED</div>');
  });

  it('keeps text escaped', () => {
    expect(sanitizeChatHtml('<p class="ai-p">1 &lt; 2 &amp; 3</p>')).toBe('<p class="ai-p">1 &lt; 2 &amp; 3</p>');
  });

  it('returns an empty string for nothing', () => {
    expect(sanitizeChatHtml('')).toBe('');
  });
});
