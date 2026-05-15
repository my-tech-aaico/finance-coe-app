export const COUNTRIES = [
  { code: "MY", label: "Malaysia", flag: "🇲🇾" },
  { code: "SG", label: "Singapore", flag: "🇸🇬" },
  { code: "HK", label: "Hong Kong", flag: "🇭🇰" },
  { code: "PH", label: "Philippines", flag: "🇵🇭" },
  { code: "AE", label: "United Arab Emirates", flag: "🇦🇪" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

export const COUNTRY_CODES = new Set<string>(COUNTRIES.map((c) => c.code));

export function getCountry(code: string) {
  return COUNTRIES.find((c) => c.code === code);
}
