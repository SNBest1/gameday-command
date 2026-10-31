import { useEffect, useRef, useState } from 'react';
import type { VehicleKind } from '../../contracts.ts';
import { FAN_TYPES } from '../../brain/src/fan-types.ts';
import { rgbCss, shirtColor, STATE_RGB } from './people.ts';
import { vehicleIcon } from './vehicleArt.ts';

/** The map key over the close-up. It opens the first time and then remembers whether you closed it. */
export function Legend() {
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem('gd-legend') !== 'closed';
    } catch {
      return true;
    }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem('gd-legend', v ? 'open' : 'closed');
    } catch {
      // private window: the key opens again next time
    }
  };
  if (!open) {
    return (
      <button className="legend-open" onClick={() => setOpen(true)} aria-expanded={false}>
        Key
      </button>
    );
  }
  return <LegendBody onClose={() => setOpen(false)} />;
}

function LegendBody({ onClose }: { onClose: () => void }) {
  const rings: [string, number][] = [
    ['walking in', 3],
    ['waiting at a gate', 2],
    ['in their seat', 4],
    ['taking shelter', 5],
    ['leaving', 6],
  ];
  return (
    <div className="map-legend">
      <button className="small ghost legend-close" onClick={onClose} aria-expanded={true} title="Hide the key">
        Hide key
      </button>
      <div className="legend-row">
        {rings.map(([text, state]) => (
          <span key={text}>
            <i className="ring" style={{ borderColor: rgbCss(STATE_RGB[state]!) }} />
            {text}
          </span>
        ))}
      </div>
      <div className="legend-row">
        <span>
          <i className="heat" /> coloured ground = how packed (key below)
        </span>
        <span>
          <i className="zone" /> incident zone
        </span>
        <span>
          <i className="cop" /> officer, click one
        </span>
        <span>
          <i className="route" /> officer route
        </span>
        <span>
          <i className="shut" /> closed
        </span>
        <span>
          <i className="alerted" /> got the alert
        </span>
        <span className="shirts" title={FAN_TYPES.map((t) => t.label).join(', ')}>
          {FAN_TYPES.slice(0, 5).map((t, i) => (
            <i key={t.id} style={{ background: `#${shirtColor(FAN_TYPES, i).toString(16).padStart(6, '0')}` }} />
          ))}
          shirt = type of fan
        </span>
      </div>
    </div>
  );
}

export function VehicleIcon({ kind }: { kind: VehicleKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) vehicleIcon(kind, ref.current, 1);
  }, [kind]);
  return <canvas ref={ref} className="vehicle-icon" />;
}
