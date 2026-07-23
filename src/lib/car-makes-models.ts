/** Глобальный справочник марок/моделей для всех тенантов CRM (РФ + популярный мир). */

export type CarMakeEntry = {
  make: string;
  models: string[];
  /** Популярность на рынке РФ (выше — выше в подсказках) */
  popularity?: number;
};

export const CAR_MAKES: CarMakeEntry[] = [
  { make: "Lada", popularity: 100, models: ["Vesta", "Granta", "Niva Travel", "Niva Legend", "Largus", "XRAY", "Priora", "Kalina", "4x4", "Iskra"] },
  { make: "Kia", popularity: 98, models: ["Rio", "Sportage", "Sorento", "Ceed", "Cerato", "K5", "Seltos", "Carnival", "Soul", "Picanto", "Stinger", "Mohave"] },
  { make: "Hyundai", popularity: 97, models: ["Solaris", "Creta", "Tucson", "Santa Fe", "Elantra", "Sonata", "Palisade", "i30", "i40", "Porter", "Staria", "Venue"] },
  { make: "Toyota", popularity: 96, models: ["Camry", "RAV4", "Land Cruiser", "Land Cruiser Prado", "Corolla", "Hilux", "Highlander", "Fortuner", "Yaris", "C-HR", "Alphard", "Prius"] },
  { make: "Volkswagen", popularity: 92, models: ["Polo", "Tiguan", "Passat", "Touareg", "Golf", "Jetta", "Taos", "Teramont", "Amarok", "Multivan", "Transporter", "Arteon"] },
  { make: "Renault", popularity: 90, models: ["Duster", "Logan", "Sandero", "Kaptur", "Arkana", "Megane", "Fluence", "Koleos", "Scenic", "Master", "Trafic"] },
  { make: "Nissan", popularity: 88, models: ["Qashqai", "X-Trail", "Almera", "Juke", "Patrol", "Murano", "Pathfinder", "Note", "Tiida", "Terrano", "Navara"] },
  { make: "Skoda", popularity: 87, models: ["Octavia", "Rapid", "Kodiaq", "Karoq", "Superb", "Fabia", "Yeti", "Kamiq", "Scala"] },
  { make: "BMW", popularity: 86, models: ["3 Series", "5 Series", "X5", "X3", "X1", "X6", "X7", "7 Series", "1 Series", "X4", "X2", "iX"] },
  { make: "Mercedes-Benz", popularity: 85, models: ["E-Class", "C-Class", "GLC", "GLE", "S-Class", "GLA", "GLB", "G-Class", "A-Class", "CLA", "Vito", "Sprinter"] },
  { make: "Audi", popularity: 84, models: ["A4", "A6", "Q5", "Q7", "A3", "Q3", "A8", "Q8", "A5", "TT", "e-tron"] },
  { make: "Mazda", popularity: 82, models: ["CX-5", "Mazda6", "Mazda3", "CX-9", "CX-30", "CX-3", "MX-5", "BT-50"] },
  { make: "Mitsubishi", popularity: 80, models: ["Outlander", "Pajero", "Pajero Sport", "ASX", "Lancer", "L200", "Eclipse Cross", "Montero"] },
  { make: "Ford", popularity: 78, models: ["Focus", "Mondeo", "Kuga", "Explorer", "EcoSport", "Fiesta", "Ranger", "Transit", "Mustang", "Escape", "Fusion"] },
  { make: "Chevrolet", popularity: 76, models: ["Niva", "Cruze", "Aveo", "Captiva", "Tahoe", "Trailblazer", "Lacetti", "Cobalt", "Spark", "Orlando"] },
  { make: "Geely", popularity: 88, models: ["Coolray", "Atlas", "Monjaro", "Emgrand", "Okavango", "Preface", "Cityray", "Tugella"] },
  { make: "Haval", popularity: 87, models: ["Jolion", "F7", "Dargo", "H9", "H6", "F7x", "M6", "Dargo X"] },
  { make: "Chery", popularity: 86, models: ["Tiggo 4", "Tiggo 7", "Tiggo 8", "Arrizo 8", "Tiggo 9", "Exeed TXL", "Tiggo 4 Pro"] },
  { make: "Changan", popularity: 84, models: ["CS35PLUS", "CS55PLUS", "UNI-K", "UNI-V", "Alsvin", "Hunter Plus", "CS75PLUS"] },
  { make: "Exeed", popularity: 80, models: ["TXL", "VX", "RX", "LX"] },
  { make: "Omoda", popularity: 79, models: ["C5", "S5", "C5 GT"] },
  { make: "Jaecoo", popularity: 78, models: ["J7", "J8"] },
  { make: "Tank", popularity: 77, models: ["300", "500", "700"] },
  { make: "Honda", popularity: 74, models: ["CR-V", "Civic", "Accord", "Pilot", "HR-V", "Jazz", "Fit", "Odyssey"] },
  { make: "Lexus", popularity: 83, models: ["RX", "NX", "LX", "ES", "GX", "UX", "IS", "LS", "CX"] },
  { make: "Subaru", popularity: 70, models: ["Forester", "Outback", "XV", "Impreza", "Legacy", "WRX", "Ascent"] },
  { make: "Suzuki", popularity: 68, models: ["Vitara", "Grand Vitara", "SX4", "Jimny", "Swift", "Ignis", "Across"] },
  { make: "Peugeot", popularity: 66, models: ["3008", "308", "408", "2008", "5008", "Partner", "Boxer", "208"] },
  { make: "Citroen", popularity: 64, models: ["C4", "C5 Aircross", "Berlingo", "C3", "Jumpy", "Jumper", "C4 Picasso"] },
  { make: "Opel", popularity: 62, models: ["Astra", "Insignia", "Mokka", "Zafira", "Corsa", "Crossland", "Grandland"] },
  { make: "Volvo", popularity: 72, models: ["XC60", "XC90", "XC40", "S60", "S90", "V60", "V90"] },
  { make: "Land Rover", popularity: 75, models: ["Range Rover", "Range Rover Sport", "Discovery", "Discovery Sport", "Freelander", "Defender", "Evoque", "Velar"] },
  { make: "Jaguar", popularity: 55, models: ["XF", "XE", "F-Pace", "E-Pace", "F-Type", "I-Pace", "XJ"] },
  { make: "Porsche", popularity: 70, models: ["Cayenne", "Macan", "Panamera", "911", "Taycan", "Boxster", "Cayman"] },
  { make: "Infiniti", popularity: 58, models: ["FX", "QX70", "QX50", "QX60", "QX80", "Q50", "JX"] },
  { make: "Genesis", popularity: 60, models: ["G70", "G80", "G90", "GV70", "GV80"] },
  { make: "Jeep", popularity: 65, models: ["Grand Cherokee", "Wrangler", "Cherokee", "Compass", "Renegade", "Gladiator"] },
  { make: "Dodge", popularity: 50, models: ["RAM", "Durango", "Charger", "Challenger", "Journey"] },
  { make: "Chrysler", popularity: 40, models: ["300C", "Pacifica", "Voyager", "Sebring"] },
  { make: "Cadillac", popularity: 48, models: ["Escalade", "XT5", "XT4", "CTS", "SRX", "XT6"] },
  { make: "GAZ", popularity: 72, models: ["Gazelle Next", "Gazelle Business", "Sobol", "Valdai", "A21R22"] },
  { make: "UAZ", popularity: 74, models: ["Patriot", "Hunter", "Bukhanka", "Pickup", "Profi", "452"] },
  { make: "Moskvich", popularity: 55, models: ["3", "3e", "6"] },
  { make: "Belgee", popularity: 60, models: ["X50", "X70", "S50"] },
  { make: "FAW", popularity: 52, models: ["Bestune T77", "Bestune T55", "Tiger"] },
  { make: "Dongfeng", popularity: 50, models: ["Shine Max", "AX7", "Rich", "Captain"] },
  { make: "Great Wall", popularity: 58, models: ["Poer", "Wingle", "Hover", "Safe"] },
  { make: "Lifan", popularity: 45, models: ["X60", "Solano", "Smily", "Myway", "Murman"] },
  { make: "Datsun", popularity: 42, models: ["on-DO", "mi-DO"] },
  { make: "SsangYong", popularity: 50, models: ["Kyron", "Actyon", "Rexton", "Korando", "Tivoli"] },
  { make: "Isuzu", popularity: 48, models: ["D-Max", "NPR", "Elf"] },
  { make: "Iveco", popularity: 46, models: ["Daily", "Eurocargo"] },
  { make: "Fiat", popularity: 44, models: ["Ducato", "Doblo", "Tipo", "500", "Panda"] },
  { make: "Mini", popularity: 50, models: ["Cooper", "Countryman", "Clubman", "Paceman"] },
  { make: "Tesla", popularity: 62, models: ["Model 3", "Model Y", "Model S", "Model X"] },
  { make: "BYD", popularity: 58, models: ["Song Plus", "Han", "Tang", "Seal", "Yuan Plus"] },
  { make: "Zeekr", popularity: 56, models: ["001", "X", "007", "9X"] },
  { make: "Voyah", popularity: 50, models: ["Free", "Dream", "Passion"] },
  { make: "Li Auto", popularity: 48, models: ["L7", "L9", "L6", "L8"] },
  { make: "Hongqi", popularity: 46, models: ["H5", "HS5", "E-HS9"] },
  { make: "Jetour", popularity: 54, models: ["Dashing", "X70", "X90", "T2"] },
  { make: "Kaiyi", popularity: 50, models: ["X3", "E5", "X7"] },
  { make: "Soueast", popularity: 42, models: ["DX8S", "DX7"] },
  { make: "Ravon", popularity: 40, models: ["R2", "R4", "Nexia R3", "Gentra"] },
  { make: "Daewoo", popularity: 38, models: ["Nexia", "Matiz", "Gentra", "Lanos"] },
  { make: "Seat", popularity: 36, models: ["Leon", "Ibiza", "Ateca", "Arona"] },
  { make: "Alfa Romeo", popularity: 34, models: ["Giulia", "Stelvio", "Giulietta"] },
  { make: "Acura", popularity: 35, models: ["MDX", "RDX", "TLX", "ILX"] },
  { make: "Lincoln", popularity: 32, models: ["Navigator", "Aviator", "Corsair"] },
  { make: "RAM", popularity: 40, models: ["1500", "2500", "ProMaster"] },
  { make: "GMC", popularity: 30, models: ["Sierra", "Yukon", "Terrain"] },
  { make: "Hummer", popularity: 28, models: ["H2", "H3", "EV"] },
  { make: "Smart", popularity: 30, models: ["Fortwo", "Forfour"] },
  { make: "Saab", popularity: 25, models: ["9-3", "9-5"] },
  { make: "Pontiac", popularity: 20, models: ["Vibe", "G6"] },
  { make: "Roewe", popularity: 30, models: ["RX5", "i5"] },
  { make: "MG", popularity: 45, models: ["ZS", "HS", "5", "4", "Marvel R"] },
  { make: "Proton", popularity: 22, models: ["Persona", "X70"] },
  { make: "Perodua", popularity: 18, models: ["Myvi", "Axia"] },
  { make: "Tata", popularity: 20, models: ["Nexon", "Safari"] },
  { make: "Mahindra", popularity: 18, models: ["XUV700", "Scorpio"] },
  { make: "Iran Khodro", popularity: 35, models: ["Samand", "Runna"] },
  { make: "HAIMA", popularity: 28, models: ["7", "8S", "M3"] },
  { make: "Brilliance", popularity: 26, models: ["V5", "H530"] },
  { make: "Zotye", popularity: 24, models: ["T600", "T700"] },
  { make: "Foton", popularity: 40, models: ["Tunland", "Aumark", "Toano"] },
  { make: "JAC", popularity: 42, models: ["T6", "T8", "S3", "JS4"] },
  { make: "Shacman", popularity: 38, models: ["X3000", "F3000"] },
  { make: "Howo", popularity: 36, models: ["A7", "T5G"] },
  { make: "KamAZ", popularity: 55, models: ["4308", "65115", "5490", "Компас"] },
  { make: "MAZ", popularity: 40, models: ["5440", "6312"] },
  { make: "Scania", popularity: 42, models: ["R-Series", "P-Series", "G-Series"] },
  { make: "MAN", popularity: 42, models: ["TGX", "TGS", "TGL"] },
  { make: "Volvo Trucks", popularity: 40, models: ["FH", "FM", "FL"] },
  { make: "Freightliner", popularity: 25, models: ["Cascadia", "M2"] },
];

/** Часто встречающиеся связки марка+модель (для пустого/короткого поиска). */
export const POPULAR_CARS: Array<{ make: string; model: string }> = [
  { make: "Lada", model: "Vesta" },
  { make: "Lada", model: "Granta" },
  { make: "Kia", model: "Rio" },
  { make: "Kia", model: "Sportage" },
  { make: "Hyundai", model: "Solaris" },
  { make: "Hyundai", model: "Creta" },
  { make: "Toyota", model: "Camry" },
  { make: "Toyota", model: "RAV4" },
  { make: "Volkswagen", model: "Polo" },
  { make: "Volkswagen", model: "Tiguan" },
  { make: "Geely", model: "Coolray" },
  { make: "Haval", model: "Jolion" },
  { make: "Renault", model: "Duster" },
  { make: "Skoda", model: "Octavia" },
  { make: "BMW", model: "X5" },
  { make: "Mercedes-Benz", model: "E-Class" },
  { make: "Chery", model: "Tiggo 7" },
  { make: "Nissan", model: "Qashqai" },
  { make: "Mazda", model: "CX-5" },
  { make: "Land Rover", model: "Freelander" },
];

const CYR_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const MAKE_ALIASES: Record<string, string> = {
  лада: "lada",
  ваз: "lada",
  киа: "kia",
  хендай: "hyundai",
  хёндай: "hyundai",
  хундай: "hyundai",
  тойота: "toyota",
  фольксваген: "volkswagen",
  фольцваген: "volkswagen",
  рено: "renault",
  ниссан: "nissan",
  шкода: "skoda",
  бмв: "bmw",
  мерседес: "mercedes-benz",
  ауди: "audi",
  мазда: "mazda",
  митсубиси: "mitsubishi",
  мицубиси: "mitsubishi",
  форд: "ford",
  шевроле: "chevrolet",
  джили: "geely",
  хавал: "haval",
  чери: "chery",
  чанган: "changan",
  хонда: "honda",
  лексус: "lexus",
  субару: "subaru",
  сузуки: "suzuki",
  пежо: "peugeot",
  ситроен: "citroen",
  опель: "opel",
  вольво: "volvo",
  ленд: "land rover",
  "ленд ровер": "land rover",
  порше: "porsche",
  тесла: "tesla",
  уаз: "uaz",
  газ: "gaz",
  камаз: "kamaz",
};

function translit(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => CYR_MAP[ch] ?? ch)
    .join("");
}

export function normalizeCarQuery(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return "";
  if (MAKE_ALIASES[t]) return MAKE_ALIASES[t];
  const tr = translit(t);
  if (MAKE_ALIASES[tr]) return MAKE_ALIASES[tr];
  return tr;
}

export type CarSuggestion = {
  make: string;
  model: string;
  label: string;
  score: number;
};

function scoreMatch(hay: string, needle: string): number {
  if (!needle) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 80;
  if (hay.includes(` ${needle}`) || hay.includes(`-${needle}`)) return 60;
  if (hay.includes(needle)) return 40;
  return 0;
}

/** 5–7 вариантов «Марка Модель» под поиском. */
export function suggestCars(query: string, limit = 7): CarSuggestion[] {
  const q = normalizeCarQuery(query);
  const out: CarSuggestion[] = [];
  const seen = new Set<string>();

  const push = (make: string, model: string, score: number) => {
    const key = `${make}|${model}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ make, model, label: `${make} ${model}`, score });
  };

  if (!q) {
    for (const p of POPULAR_CARS.slice(0, limit)) push(p.make, p.model, 50);
    return out;
  }

  const makesSorted = [...CAR_MAKES].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

  for (const entry of makesSorted) {
    const makeN = normalizeCarQuery(entry.make);
    const makeScore = scoreMatch(makeN, q);
    if (makeScore > 0) {
      const models = entry.models.slice(0, 3);
      for (const m of models) push(entry.make, m, makeScore + (entry.popularity || 0) / 100);
    }
    for (const model of entry.models) {
      const modelN = normalizeCarQuery(model);
      const combo = `${makeN} ${modelN}`;
      const ms = scoreMatch(modelN, q);
      const cs = scoreMatch(combo, q);
      const best = Math.max(ms, cs);
      if (best > 0) {
        push(entry.make, model, best + (entry.popularity || 0) / 100 + (makeScore ? 5 : 0));
      }
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function modelsForMake(make: string): string[] {
  const n = normalizeCarQuery(make);
  if (!n) return [];
  const entry = CAR_MAKES.find((m) => normalizeCarQuery(m.make) === n)
    || CAR_MAKES.find((m) => normalizeCarQuery(m.make).startsWith(n))
    || CAR_MAKES.find((m) => n.startsWith(normalizeCarQuery(m.make)));
  return entry?.models || [];
}

export function suggestMakes(query: string, limit = 7): string[] {
  const q = normalizeCarQuery(query);
  if (!q) {
    return [...CAR_MAKES]
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, limit)
      .map((m) => m.make);
  }
  return [...CAR_MAKES]
    .map((m) => ({ make: m.make, score: scoreMatch(normalizeCarQuery(m.make), q) + (m.popularity || 0) / 1000 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.make);
}
