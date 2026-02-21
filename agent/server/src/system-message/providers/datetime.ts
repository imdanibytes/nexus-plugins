import type { SystemMessageProvider } from "../types.js";

export const datetimeProvider: SystemMessageProvider = {
  name: "datetime",
  timeoutMs: 50,

  async provide(): Promise<string> {
    const now = new Date();
    const date = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const time = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return `<datetime>\nCurrent date and time: ${date} ${time}\n</datetime>`;
  },
};
