import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#a8472c",
          dark: "#84351f",
          light: "#c45a3c",
        },
      },
    },
  },
  plugins: [],
};

export default config;
