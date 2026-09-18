// A roof sign has room for a brand, not a legal entity: "Mamee Double Decker Distribution (M) Sdn Bhd" → "Mamee Double Decker".
const LEGAL = /\s*[,(]?\s*\b(sdn\.?\s*bhd\.?|berhad|bhd\.?|plt|pte\.?\s*ltd\.?|pvt\.?\s*ltd\.?|private limited|co\.?\s*,?\s*ltd\.?|company limited|limited|ltd\.?|llc|inc\.?|corporation|corp\.?|gmbh|s\.?a\.?r\.?l\.?|tbk|pt\.?)\b\.?\)?/gi;
const FILLER = /\b(distribution|marketing|manufacturing|industries|industry|trading|enterprise|enterprises|resources|international|global|group of companies|holdings?)\b/gi;

export function shortName(full) {
  let s = full.replace(/\((m|malaysia|asia|my)\)/gi, ' ').replace(LEGAL, ' ').replace(/\s{2,}/g, ' ').replace(/[\s,.&-]+$/, '').trim();
  // only drop business-type words when what is left still reads as a name
  const lean = s.replace(FILLER, ' ').replace(/\s{2,}/g, ' ').replace(/[\s,.&-]+$/, '').trim();
  if (lean.length >= 4 && lean.split(' ').length >= 1 && s.length > 22) s = lean;
  return s.length > 34 ? s.slice(0, 33).trimEnd() + '…' : s;
}
