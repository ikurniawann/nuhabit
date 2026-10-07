export function shouldAnimateVerticalMarquee(
  contentHeight: number,
  viewportHeight: number
): boolean {
  return contentHeight > viewportHeight;
}
