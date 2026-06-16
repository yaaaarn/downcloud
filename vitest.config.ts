import { defineConfig } from "vitest/config";
import codspeed from "@codspeed/vitest-plugin";

export default defineConfig({
  plugins: [codspeed()],
});
