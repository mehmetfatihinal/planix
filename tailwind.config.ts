import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#FAF7F2",
        card: "#FFFFFF",
        primary: "#8B1E2D",
        primaryDark: "#641421",
        accent: "#C9A66B",
        beige: "#EFE4D3",
        text: "#1F1F1F",
        muted: "#6B625B",
        success: "#2F7D5C",
        warning: "#B7791F",
        danger: "#B91C1C",
        darkBg: "#121212",
        darkCard: "#1E1E1E",
        darkPrimary: "#B43A4A",
        darkMuted: "#A8A29E",
        darkBorder: "#2A2A2A"
      },
      boxShadow: {
        premium: "0 18px 45px rgba(31, 31, 31, 0.08)",
        soft: "0 10px 30px rgba(31, 31, 31, 0.06)"
      },
      borderRadius: {
        "2xl": "1rem"
      }
    }
  },
  plugins: []
};

export default config;
