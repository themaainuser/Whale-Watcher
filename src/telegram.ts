export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[telegram dry-run]", text);
    return true;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      // Telegram's body carries the concrete config mistake (e.g. "chat not
      // found", "Unauthorized"); a bare status leaves setup failures cryptic.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(
        `telegram sendMessage failed with status ${res.status}${detail ? `: ${detail}` : ""}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("telegram sendMessage failed", err);
    return false;
  }
}
