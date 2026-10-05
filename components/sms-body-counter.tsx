"use client";

import { countSmsUnits } from "@/utils/sms-message-segments";

type SmsBodyCounterProps = {
  body: string;
  className?: string;
};

export default function SmsBodyCounter({
  body,
  className = "",
}: SmsBodyCounterProps) {
  const stats = countSmsUnits(body);

  return (
    <span className={`text-xs text-slate-500 ${className}`.trim()}>
      {stats.characters} character{stats.characters === 1 ? "" : "s"}
      {stats.characters > 0
        ? ` · ${stats.segments} SMS part${stats.segments === 1 ? "" : "s"} (${stats.encoding}, ${stats.singleSegmentSize}/part)`
        : ""}
    </span>
  );
}
