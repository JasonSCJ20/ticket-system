import { jest } from '@jest/globals';

process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';

const { sendTelegramMessage } = await import('../src/telegram.js');

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe('sendTelegramMessage', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('posts directly to the Telegram Bot API with the configured token, chat id, and text', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

    const result = await sendTelegramMessage('123', 'hello there', { parse_mode: 'Markdown' });

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-telegram-token/sendMessage');
    expect(opts.method).toBe('POST');
    const sentBody = JSON.parse(opts.body);
    expect(sentBody).toEqual({ chat_id: '123', text: 'hello there', parse_mode: 'Markdown' });
  });

  it('returns false without calling fetch when no chatId is given', async () => {
    const result = await sendTelegramMessage(null, 'hello');
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries on an HTTP-200-but-{ok:false} Telegram response, then gives up', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: false, description: 'chat not found' }, true));

    const result = await sendTelegramMessage('123', 'hello', { retries: 1 });

    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // initial attempt + 1 retry
  });

  it('retries on a network-level rejection, then succeeds if a later attempt works', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await sendTelegramMessage('123', 'hello', { retries: 2 });

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not leak the retries option into the request body sent to Telegram', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

    await sendTelegramMessage('123', 'hello', { retries: 0, parse_mode: 'Markdown' });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.retries).toBeUndefined();
    expect(sentBody.parse_mode).toBe('Markdown');
  });
});
