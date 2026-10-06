import { DarkTheme } from "expo-router/react-navigation";
import type { Theme } from "expo-router/react-navigation";

// React Navigation needs concrete colors; these mirror the tokens in global.css.
export const COLORS = {
  bulb: "#FF5A4E",
  ink: "#17162E",
  night: "#1C1D45",
  paper: "#F4F3FF",
  raised: "#2A2C66",
  ticket: "#FFD84A",
};

export const NAV_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: COLORS.night,
    border: "#3A3D80",
    card: COLORS.night,
    notification: COLORS.bulb,
    primary: COLORS.ticket,
    text: COLORS.paper,
  },
};
