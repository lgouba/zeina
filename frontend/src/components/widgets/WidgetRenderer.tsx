import type { Widget } from "../../types/api";
import { ValueWidget } from "./ValueWidget";
import { LineWidget } from "./LineWidget";
import { AreaWidget } from "./AreaWidget";
import { BarWidget } from "./BarWidget";
import { GaugeWidget } from "./GaugeWidget";
import { StateWidget } from "./StateWidget";
import { MapWidget } from "./MapWidget";

export function WidgetRenderer({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case "value": return <ValueWidget widget={widget} />;
    case "line":  return <LineWidget widget={widget} />;
    case "area":  return <AreaWidget widget={widget} />;
    case "bar":   return <BarWidget widget={widget} />;
    case "gauge": return <GaugeWidget widget={widget} />;
    case "state": return <StateWidget widget={widget} />;
    case "map":   return <MapWidget widget={widget} />;
    default: return <div className="text-xs text-slate-500">Type widget inconnu : {widget.type}</div>;
  }
}

// Helper utilisé par les widgets pour retrouver l'identité d'un device.
export interface DeviceRef {
  device_id: string;
  device_slug: string;
  site_slug: string;
  measurement?: string;
  unit?: string;
}
