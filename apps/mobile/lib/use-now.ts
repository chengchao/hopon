import { useEffect, useState } from "react";

// The time, read again every `everyMs` while that is set: what a running turn's clock and a Draft's "2 h ago" read.
export const useNow = (everyMs: number | undefined) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (everyMs === undefined) {
      return;
    }
    const read = () => setNow(Date.now());
    // At once too: the last reading may be from long before the ticking started.
    const first = setTimeout(read, 0);
    const timer = setInterval(read, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
};
