export const HANDBOOK_SCREENSHOTS_BUCKET = "handbook-screenshots";

export function getHandbookScreenshotStoragePath(sectionKey: string): string {
  return `${sectionKey}/${crypto.randomUUID()}.png`;
}
