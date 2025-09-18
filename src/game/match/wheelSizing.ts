export const MIN_WHEEL = 160;
export const MAX_WHEEL = 200;

export function calcWheelSize(viewHeight: number, viewWidth: number, dockAllowance = 0) {
  const isMobile = viewWidth <= 480;
  const chromeAllowance = viewWidth >= 1024 ? 200 : 140;
  const raw = Math.floor((viewHeight - chromeAllowance - dockAllowance) / 3);
  const MOBILE_MAX = 188;
  const DESKTOP_MAX = 220;
  const maxAllowed = isMobile ? MOBILE_MAX : DESKTOP_MAX;
  return Math.max(MIN_WHEEL, Math.min(maxAllowed, raw));
}
