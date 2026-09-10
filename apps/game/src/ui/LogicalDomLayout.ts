export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LogicalDomLayout {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  scale: number;
}

export function getLogicalDomLayout(
  canvas: ViewportRect,
  logicalSize: { width: number; height: number },
  element: { x: number; y: number; width: number; height: number }
): LogicalDomLayout {
  const scaleX = canvas.width / logicalSize.width;
  const scaleY = canvas.height / logicalSize.height;

  return {
    centerX: canvas.left + element.x * scaleX,
    centerY: canvas.top + element.y * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
    scale: Math.min(scaleX, scaleY),
  };
}
