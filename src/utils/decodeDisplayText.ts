/**
 * 安全解码可能被 URL 编码的展示文本（如路径、任务标题、用户输入）。
 * 若字符串包含 %xx 编码（如 %20、%E8%8E%B7%E5%8F%96），解码为可读字符；解码失败则返回原串。
 */
export function decodeDisplayText(text: string | null | undefined): string {
  if (text == null || typeof text !== 'string') return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
