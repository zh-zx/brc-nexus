import React from 'react';

/**
 * 毫米级画布标尺（LabelNova 2.2：画布上方和左侧配高精度标尺）
 * pxPerMm：当前缩放下每毫米对应的屏幕像素数
 */

const RULER_W = 18; // 标尺厚度 px

function ticks(wmm: number, pxPerMm: number) {
  const items: { mm: number; level: 1 | 5 | 10 }[] = [];
  const showMinor = pxPerMm >= 5;      // 1mm 刻度仅在足够放大时显示
  for (let mm = 0; mm <= Math.ceil(wmm); mm++) {
    if (mm % 10 === 0) items.push({ mm, level: 10 });
    else if (mm % 5 === 0) items.push({ mm, level: 5 });
    else if (showMinor) items.push({ mm, level: 1 });
  }
  return items;
}

export const RulerH: React.FC<{ wmm: number; pxPerMm: number }> = ({ wmm, pxPerMm }) => {
  const w = wmm * pxPerMm;
  const h = RULER_W;
  return (
    <div style={{ width: w, height: h }} className="bg-white border-b border-r border-gray-300 select-none overflow-hidden">
      <svg width={w} height={h} shapeRendering="crispEdges">
        {ticks(wmm, pxPerMm).map(t => {
          const x = Math.round(t.mm * pxPerMm) + 0.5;
          const len = t.level === 10 ? h - 3 : t.level === 5 ? h / 2 : h / 4;
          return (
            <g key={t.mm}>
              <line x1={x} y1={h} x2={x} y2={h - len} stroke={t.level === 10 ? '#6b7280' : '#9ca3af'} strokeWidth={1} />
              {t.level === 10 && t.mm > 0 && (
                <text x={x + 2} y={9} fontSize={8} fill="#6b7280" fontFamily="monospace">{t.mm}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const RulerV: React.FC<{ hmm: number; pxPerMm: number }> = ({ hmm, pxPerMm }) => {
  const h = hmm * pxPerMm;
  const w = RULER_W;
  return (
    <div style={{ width: w, height: h }} className="bg-white border-b border-r border-gray-300 select-none overflow-hidden">
      <svg width={w} height={h} shapeRendering="crispEdges">
        {ticks(hmm, pxPerMm).map(t => {
          const y = Math.round(t.mm * pxPerMm) + 0.5;
          const len = t.level === 10 ? w - 3 : t.level === 5 ? w / 2 : w / 4;
          return (
            <g key={t.mm}>
              <line x1={w} y1={y} x2={w - len} y2={y} stroke={t.level === 10 ? '#6b7280' : '#9ca3af'} strokeWidth={1} />
              {t.level === 10 && t.mm > 0 && (
                <text x={w - 12} y={y - 2} fontSize={8} fill="#6b7280" fontFamily="monospace" transform={`rotate(-90 ${w - 12} ${y - 2})`}>{t.mm}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const RULER_SIZE = RULER_W;
