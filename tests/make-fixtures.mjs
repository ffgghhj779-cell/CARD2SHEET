// Generates synthetic test images with known ground truth.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve("tests/fixtures");
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function cardSvg({ w = 1050, h = 600, bg = "#ffffff", accent = "#1f4e78", lines }) {
  const t = lines
    .map(
      (l) =>
        `<text x="${l.x}" y="${l.y}" font-family="${l.font ?? "Tahoma, Arial"}" font-size="${l.size ?? 34}" ` +
        `font-weight="${l.bold ? 700 : 400}" fill="${l.color ?? "#222"}" text-anchor="${l.anchor ?? "start"}">${esc(l.text)}</text>`,
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect width="100%" height="18" fill="${accent}"/>
  <rect y="${h - 12}" width="100%" height="12" fill="${accent}"/>
  ${t}</svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

// ---------- card definitions (ground truth lives in tests/cases.json) ----------
const sedra = cardSvg({
  lines: [
    { x: 1000, y: 95, text: "تموين سدرة", size: 54, bold: true, anchor: "end", rtl: true, color: "#1f4e78" },
    { x: 50, y: 95, text: "SEDRA CATERING", size: 44, bold: true, color: "#1f4e78" },
    { x: 1000, y: 200, text: "اكرم الخميسي", size: 44, bold: true, anchor: "end", rtl: true },
    { x: 1000, y: 250, text: "المدير العام", size: 32, anchor: "end", rtl: true },
    { x: 50, y: 200, text: "Akram Al-Khamisi", size: 40, bold: true },
    { x: 50, y: 250, text: "General Manager", size: 30 },
    { x: 50, y: 360, text: "Mobile: +966 55 552 8123", size: 32 },
    { x: 50, y: 410, text: "Tel: 012 540 7788", size: 32 },
    { x: 50, y: 460, text: "akram@sedra-catering.com", size: 32 },
    { x: 50, y: 510, text: "www.sedra-catering.com", size: 32 },
    { x: 1000, y: 510, text: "مكة المكرمة - حراج المعيصم", size: 30, anchor: "end", rtl: true },
  ],
});

const chalets = cardSvg({
  bg: "#fbf7ef",
  accent: "#8a5a00",
  lines: [
    { x: 1000, y: 110, text: "شاليهات الريم", size: 58, bold: true, anchor: "end", rtl: true, color: "#8a5a00" },
    { x: 1000, y: 230, text: "محمد عبدالله السالمي", size: 42, bold: true, anchor: "end", rtl: true },
    { x: 1000, y: 285, text: "مدير الحجوزات", size: 32, anchor: "end", rtl: true },
    { x: 1000, y: 390, text: "جوال: ٠٥٧ ٦٨٠ ٠٧٣٠", size: 38, bold: true, anchor: "end", rtl: true },
    { x: 1000, y: 450, text: "واتساب: ٠٥٠ ١٢٣ ٤٥٦٧", size: 38, bold: true, anchor: "end", rtl: true },
    { x: 1000, y: 520, text: "الطائف - الهدا", size: 32, anchor: "end", rtl: true },
  ],
});

const yemen = cardSvg({
  bg: "#f2f7f2",
  accent: "#2e7d32",
  lines: [
    { x: 50, y: 100, text: "AL-NOOR TRADING & GENERAL SUPPLIES", size: 38, bold: true, color: "#2e7d32" },
    { x: 1000, y: 160, text: "مؤسسة النور للتجارة والتوريدات العامة", size: 34, anchor: "end", rtl: true, color: "#2e7d32" },
    { x: 50, y: 260, text: "Eng. Fahd Saleh Al-Hamdani", size: 38, bold: true },
    { x: 50, y: 305, text: "Sales Director", size: 30 },
    { x: 50, y: 400, text: "+967 776 311 133", size: 32 },
    { x: 50, y: 445, text: "+967 1 445 566   Fax: +967 1 445 567", size: 30 },
    { x: 50, y: 490, text: "fahd.hamdani@alnoor-ye.com", size: 30 },
    { x: 50, y: 540, text: "Hadda St., Sana'a - Yemen", size: 30 },
  ],
});

const tech = cardSvg({
  bg: "#111827",
  accent: "#22d3ee",
  lines: [
    { x: 50, y: 110, text: "NEXORA", size: 64, bold: true, color: "#22d3ee" },
    { x: 50, y: 150, text: "Cloud & Software Solutions", size: 26, color: "#9ca3af" },
    { x: 50, y: 270, text: "Sara Johnson", size: 44, bold: true, color: "#ffffff" },
    { x: 50, y: 320, text: "Business Development Manager", size: 30, color: "#d1d5db" },
    { x: 50, y: 420, text: "M: +971 50 123 4567", size: 30, color: "#ffffff" },
    { x: 50, y: 465, text: "sara.j@nexora.ae", size: 30, color: "#ffffff" },
    { x: 50, y: 510, text: "nexora.ae  |  Dubai Internet City, UAE", size: 28, color: "#ffffff" },
  ],
});

const seasons = cardSvg({
  lines: [
    { x: 1000, y: 110, text: "تجهيزات المواسم للتجارة", size: 50, bold: true, anchor: "end", rtl: true, color: "#6a1b9a" },
    { x: 1000, y: 230, text: "خالد ناصر العتيبي", size: 42, bold: true, anchor: "end", rtl: true },
    { x: 1000, y: 285, text: "مسؤول المبيعات", size: 32, anchor: "end", rtl: true },
    { x: 50, y: 400, text: "0533 221 900", size: 34 },
    { x: 50, y: 450, text: "sales@mawasim-trade.sa", size: 32 },
    { x: 1000, y: 520, text: "الرياض - حي السلي", size: 32, anchor: "end", rtl: true },
  ],
});

const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1000">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect width="100%" height="220" fill="#c62828"/>
  <text x="350" y="110" font-family="Arial" font-size="54" font-weight="700" fill="#fff" text-anchor="middle">HAJJ EXPO 2026</text>
  <text x="350" y="170" font-family="Arial" font-size="30" fill="#fff" text-anchor="middle">EXHIBITOR</text>
  <text x="350" y="430" font-family="Arial" font-size="60" font-weight="700" fill="#111" text-anchor="middle">Omar Haddad</text>
  <text x="350" y="500" font-family="Tahoma" font-size="46" fill="#111" text-anchor="middle">عمر حداد</text>
  <text x="350" y="590" font-family="Arial" font-size="36" fill="#333" text-anchor="middle">Operations Manager</text>
  <text x="350" y="660" font-family="Arial" font-size="40" font-weight="700" fill="#c62828" text-anchor="middle">Zamzam Logistics</text>
  <text x="350" y="900" font-family="Arial" font-size="30" fill="#555" text-anchor="middle">Jeddah - Saudi Arabia</text>
</svg>`;

async function main() {
  const [bSedra, bChalets, bYemen, bTech, bSeasons, bBadge] = await Promise.all([sedra, chalets, yemen, tech, seasons, badge].map(png));
  const save = (name, buf) => fs.writeFileSync(path.join(OUT, name), buf);

  save("01_bilingual_sedra.jpg", await sharp(bSedra).jpeg({ quality: 90 }).toBuffer());
  save("02_rotated90_sedra.jpg", await sharp(bSedra).rotate(90).jpeg().toBuffer());
  save("03_upside_down_yemen.jpg", await sharp(bYemen).rotate(180).jpeg().toBuffer());
  save("04_arabic_only_indic_digits.jpg", await sharp(bChalets).jpeg().toBuffer());
  save("05_dark_tech_card.jpg", await sharp(bTech).jpeg().toBuffer());
  save("06_badge.jpg", await sharp(bBadge).jpeg().toBuffer());

  // skewed + blurred + glare + shadow, small resolution (realistic quick phone shot)
  const glare = await png(`<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="600">
    <defs><radialGradient id="g" cx="70%" cy="30%" r="35%"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#s)"/><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const withGlare = await sharp(bSeasons).composite([{ input: glare }]).png().toBuffer();
  const degraded = await sharp(withGlare).blur(1.0).rotate(-12, { background: "#6b5b4b" }).resize({ width: 900 }).jpeg({ quality: 65 }).toBuffer();
  save("07_skew_glare_blur_seasons.jpg", degraded);

  // multi: 3 cards + badge on a wooden table, mixed rotations
  const table = sharp({ create: { width: 2800, height: 2200, channels: 3, background: "#7a5230" } });
  const c1 = await sharp(bSedra).resize({ width: 1000 }).rotate(-6, { background: "#7a5230" }).png().toBuffer();
  const c2 = await sharp(bYemen).resize({ width: 1000 }).rotate(8, { background: "#7a5230" }).png().toBuffer();
  const c3 = await sharp(bTech).resize({ width: 1000 }).rotate(90, { background: "#7a5230" }).png().toBuffer();
  const c4 = await sharp(bBadge).resize({ width: 520 }).rotate(-4, { background: "#7a5230" }).png().toBuffer();
  save(
    "08_multi_3cards_1badge.jpg",
    await table.composite([
      { input: c1, left: 80, top: 80 },
      { input: c2, left: 80, top: 900 },
      { input: c3, left: 1250, top: 120 },
      { input: c4, left: 2050, top: 700 },
    ]).jpeg({ quality: 85 }).toBuffer(),
  );

  // irrelevant photo (no contacts)
  const noise = await png(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <rect width="100%" height="100%" fill="#87ceeb"/><rect y="500" width="100%" height="300" fill="#3a7d2c"/>
    <circle cx="950" cy="160" r="90" fill="#ffd54f"/><polygon points="200,500 420,220 640,500" fill="#6d4c41"/></svg>`);
  save("09_no_contacts_landscape.jpg", await sharp(noise).jpeg().toBuffer());

  console.log("fixtures written to", OUT);
}
main();
