// FormData readers for server actions: everything from the browser is text until checked here
export type FormState = { error?: string; ok?: string } | null;

export const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);

// "12 500" → 12500; NaN if not a whole number
export const int = (fd: FormData, k: string) => {
  const v = str(fd, k).replace(/\s/g, "");
  return /^-?\d+$/.test(v) ? Number(v) : NaN;
};

export const day = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};

export const hm = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return /^\d{2}:\d{2}$/.test(v) ? v : null;
};

// ids go straight into SQL as uuid: anything else would be a 500 from Postgres
export const uuid = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
};

export const oneOf = <T extends string>(fd: FormData, k: string, opts: readonly T[], fallback: T): T => {
  const v = str(fd, k) as T;
  return opts.includes(v) ? v : fallback;
};

// "packs:<productId>" style fields: [{ key: productId, value: number }]
export const prefixed = (fd: FormData, prefix: string) =>
  [...fd.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k.slice(prefix.length), value: int(fd, k) }));
