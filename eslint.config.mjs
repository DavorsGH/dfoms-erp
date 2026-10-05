import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const dialogRestrictionMessage =
  "Use confirmDialog, alertDialog, or promptDialog from @/components/feedback/app-dialogs instead of native browser dialogs.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: [
      "app/**/*.{js,jsx,ts,tsx}",
      "components/**/*.{js,jsx,ts,tsx}",
      "utils/**/*.{js,jsx,ts,tsx}",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: dialogRestrictionMessage },
        { name: "alert", message: dialogRestrictionMessage },
        { name: "prompt", message: dialogRestrictionMessage },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='window'][property.name='confirm']",
          message: dialogRestrictionMessage,
        },
        {
          selector:
            "MemberExpression[object.name='window'][property.name='alert']",
          message: dialogRestrictionMessage,
        },
        {
          selector:
            "MemberExpression[object.name='window'][property.name='prompt']",
          message: dialogRestrictionMessage,
        },
      ],
    },
  },
]);

export default eslintConfig;
