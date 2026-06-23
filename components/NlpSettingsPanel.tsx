"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Save } from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";

// ─── Base vocabulary constants (mirrors nlp_engine.py BASE_* values) ──────────
const BASE_PRODUCT =
  "cimory, cimori, yogurt, susu, milk, squeeze, pouch, matcha, marie, biscuit, chocolate, strawberry, blueberry, mangga, mango, peach, taro, original, plain, gula, less sugar, tanpa gula, lactose, bebas lactose, lactose free, rasa, botol, drink, taste, flavour, flavor, sweetness, bottle, stroberi, choco mint, chocolate mint, coklat mint, sea salt, tanpa gula tambahan, stevia, biskuit, coklat, almond, laktosa, bebas laktosa, hazelnut, tiramisu, banyak rasa, creamy, light, uht, cashew";
const BASE_INFLUENCER =
  "cantik, ganteng, outfit, baju, spill, kak, kakak, abang, teh, teteh, mba, mbak, mas, rambut, makeup, lucu, gemes, gemoy, keren, idol";
const BASE_POSITIVE =
  "enak, mantap, suka, nagih, borong, segar, seger, halal, asli, murah, bagus, cocok, sip, boleh, rekomendasi, rekomen, love, good, best, fresh, tasty, delicious, yummy, worth, amazing, awesome, nice, perfect, favorite, favourite, recommend, like, happy, happier, great, excellent, fantastic, wonderful, obsessed, cool, enjoy, enjoyed, superb, brilliant, glad, addictive, kesukaan, mewah, nikmat, kriuk, kumplit, nostalgia, booster, cinta, juara";
const BASE_NEGATIVE =
  "mahal, kecewa, asem, kecut, aneh, bosen, kurang, cair, manis, eneg, pusing, zonk, boong, jelek, basi, bad, expensive, pricey, overpriced, awful, terrible, disgusting, sour, hate, boring, worst, sad, mad, angry, upset";
const BASE_HEALTH =
  "protein, tinggi protein, sehat, healthy, mindful, diet, nutrisi, gizi, kalori, rendah, low sugar";
const BASE_INTENT =
  "beli, dimana, indomaret, alfamart, stock, stok, pesen, order, harga, cari, ready, toko, supermarket, checkout, keranjang, mau, coba, cobain, nyoba, nyobain, penasaran, kepo, pengen, tertarik";
const BASE_NEGATION =
  "tidak, bukan, jangan, belum, banget, paling, beneran, really, very, super, parah, sekali, amat, sangat, juara, harus, hrs";
const BASE_SPAM =
  "demi allah, like komen, orang tercepat, fb serius, follback, cek dm, p adu jam, titip sendal, hadir, absen, subs";
const BASE_EMOJI_POS = "❤️, 💖, 🔥, 👍, 😋, 😍, 👏, 🤤, 🥛, 💯, ✨";
const BASE_EMOJI_NEG = "🤮, 💩, 😡, 👎, 😒, 🤡, 💀, 🙃, 🤢, 🗿";
const BASE_REACTION  = "tertawa, lol, wow, thinking";

const DEFAULT_THEMES = [
  { Theme: "Lactose Focus",     Keywords: "lactose, laktosa, bebas laktosa, lactose free" },
  { Theme: "Sugar / Sweetness", Keywords: "gula, manis, less sugar, stevia, tanpa gula, kemanisan" },
  { Theme: "Packaging",         Keywords: "botol, bottle, pouch, squeeze" },
  { Theme: "Price Sensitivity", Keywords: "harga, mahal, murah, price, murmer, promo, diskon" },
  { Theme: "Diet & Health",     Keywords: "diet, protein, kalori, sehat, nutrisi" },
];

const DEFAULT_SLANG = [
  { Original: "yg",     Replacement: "yang" },
  { Original: "bgt",    Replacement: "banget" },
  { Original: "gpp",    Replacement: "tidak apa-apa" },
  { Original: "klo",    Replacement: "kalau" },
  { Original: "cimori", Replacement: "cimory" },
];

const DEFAULT_PR = [
  {
    "Alert Name":    "Fresh Milk",
    "Exact Phrases": "33%, 33 persen, cuma 33, 33 doang, fresh milk, susu segar",
    "Keywords":      "kandungan, komposisi, campuran, kadar, persentase",
    "Triggers":      "dikit, sedikit, cuma, doang, kurang, air",
  },
];

const ACCENT = "#f472b6";

// ─── Simple editable table component ─────────────────────────────────────────
type RowData = Record<string, string>;

function EditableTable({
  columns,
  rows,
  onChange,
  columnHelp,
}: {
  columns: string[];
  rows: RowData[];
  onChange: (r: RowData[]) => void;
  columnHelp?: Record<string, string>;
}) {
  function update(rowIdx: number, col: string, val: string) {
    const next = rows.map((r, i) => (i === rowIdx ? { ...r, [col]: val } : r));
    onChange(next);
  }

  function remove(rowIdx: number) {
    onChange(rows.filter((_, i) => i !== rowIdx));
  }

  function addRow() {
    onChange([...rows, Object.fromEntries(columns.map((c) => [c, ""]))]);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {col}
                {columnHelp?.[col] && (
                  <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground opacity-70">
                    — {columnHelp[col]}
                  </span>
                )}
              </th>
            ))}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-muted/50">
              {columns.map((col) => (
                <td key={col} className="px-2 py-1">
                  <input
                    type="text"
                    value={row[col] ?? ""}
                    onChange={(e) => update(rowIdx, col, e.target.value)}
                    className="w-full px-2 py-1 text-sm rounded bg-transparent border border-transparent hover:border-border focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground"
                  />
                </td>
              ))}
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => remove(rowIdx)}
                  className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={addRow}
        className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:opacity-80 transition-opacity"
      >
        <Plus className="w-3.5 h-3.5" />
        Add row
      </button>
    </div>
  );
}

const textareaCls =
  "w-full px-3 py-2 text-xs rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y font-mono";

// ─── Main page ────────────────────────────────────────────────────────────────
export function NlpSettingsPanel() {
  const { activeProjectId, activeProjectName } = useProject();

  const [productKw,   setProductKw]   = useState(BASE_PRODUCT);
  const [influencerKw,setInfluencerKw]= useState(BASE_INFLUENCER);
  const [intentKw,    setIntentKw]    = useState(BASE_INTENT);
  const [healthKw,    setHealthKw]    = useState(BASE_HEALTH);
  const [positiveKw,  setPositiveKw]  = useState(BASE_POSITIVE);
  const [negativeKw,  setNegativeKw]  = useState(BASE_NEGATIVE);
  const [negationKw,  setNegationKw]  = useState(BASE_NEGATION);
  const [spamKw,      setSpamKw]      = useState(BASE_SPAM);
  const [posEmoji,    setPosEmoji]    = useState(BASE_EMOJI_POS);
  const [negEmoji,    setNegEmoji]    = useState(BASE_EMOJI_NEG);
  const [reactionKw,  setReactionKw]  = useState(BASE_REACTION);
  const [brandHandle, setBrandHandle] = useState("cimory");

  const [prRows,    setPrRows]    = useState<RowData[]>(DEFAULT_PR);
  const [themeRows, setThemeRows] = useState<RowData[]>(DEFAULT_THEMES);
  const [slangRows, setSlangRows] = useState<RowData[]>(DEFAULT_SLANG);

  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/nlp-config?project_id=${activeProjectId}`);
      const { config } = await res.json() as { config: Record<string, unknown> | null };
      if (!config) return;

      if (config.product_keywords)    setProductKw(String(config.product_keywords));
      if (config.influencer_keywords) setInfluencerKw(String(config.influencer_keywords));
      if (config.intent_keywords)     setIntentKw(String(config.intent_keywords));
      if (config.health_keywords)     setHealthKw(String(config.health_keywords));
      if (config.positive_words)      setPositiveKw(String(config.positive_words));
      if (config.negative_words)      setNegativeKw(String(config.negative_words));
      if (config.negation_words)      setNegationKw(String(config.negation_words));
      if (config.spam_phrases)        setSpamKw(String(config.spam_phrases));
      if (config.positive_emojis)     setPosEmoji(String(config.positive_emojis));
      if (config.negative_emojis)     setNegEmoji(String(config.negative_emojis));
      if (config.reaction_words)      setReactionKw(String(config.reaction_words));
      if (config.brand_handle)        setBrandHandle(String(config.brand_handle));

      const rawPr = config.pr_alerts;
      if (Array.isArray(rawPr) && rawPr.length > 0) {
        setPrRows((rawPr as Record<string, unknown>[]).map((a) => ({
          "Alert Name":    String(a["Alert Name"] ?? a.name ?? ""),
          "Exact Phrases": String(a["Exact Phrases"] ?? a.phrases ?? ""),
          "Keywords":      String(a["Keywords"] ?? a.keywords ?? ""),
          "Triggers":      String(a["Triggers"] ?? a.triggers ?? ""),
        })));
      }
      const rawThemes = config.theme_map;
      if (Array.isArray(rawThemes) && rawThemes.length > 0) {
        setThemeRows((rawThemes as Record<string, unknown>[]).map((t) => ({
          Theme:    String(t.Theme ?? t.name ?? ""),
          Keywords: String(t.Keywords ?? t.keywords ?? ""),
        })));
      }
      const rawSlang = config.slang_map;
      if (Array.isArray(rawSlang) && rawSlang.length > 0) {
        setSlangRows((rawSlang as Record<string, unknown>[]).map((s) => ({
          Original:    String(s.Original ?? s.original ?? ""),
          Replacement: String(s.Replacement ?? s.replacement ?? ""),
        })));
      }
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  async function handleSave() {
    if (!activeProjectId) return;
    setSaving(true);
    setSaveMsg(null);

    const validPr = prRows.filter((r) => r["Alert Name"]?.trim());
    const validThemes = themeRows.filter((r) => r.Theme?.trim());
    const validSlang  = slangRows.filter((r) => r.Original?.trim() && r.Replacement?.trim());

    try {
      const res = await fetch("/api/nlp-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id:          activeProjectId,
          product_keywords:    productKw,
          influencer_keywords: influencerKw,
          intent_keywords:     intentKw,
          health_keywords:     healthKw,
          positive_words:      positiveKw,
          negative_words:      negativeKw,
          negation_words:      negationKw,
          spam_phrases:        spamKw,
          positive_emojis:     posEmoji,
          negative_emojis:     negEmoji,
          reaction_words:      reactionKw,
          brand_handle:        brandHandle,
          pr_alerts:  validPr.map((r) => ({
            name:     r["Alert Name"],
            phrases:  r["Exact Phrases"],
            keywords: r["Keywords"],
            triggers: r["Triggers"],
          })),
          theme_map: validThemes.map((r) => ({ Theme: r.Theme, Keywords: r.Keywords })),
          slang_map: validSlang.map((r) => ({ Original: r.Original, Replacement: r.Replacement })),
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setSaveMsg({ ok: true, text: "Saved! Re-generate your Excel in Queue to see updated scores." });
      } else {
        setSaveMsg({ ok: false, text: data.error ?? "Save failed." });
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error — save failed." });
    } finally {
      setSaving(false);
    }
  }

  if (!activeProjectId) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-xl font-bold text-foreground mb-4">NLP Settings</h1>
        <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          Select a project to configure its NLP settings.
        </div>
      </div>
    );
  }

  const SaveButton = ({ className = "" }: { className?: string }) => (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving || loading}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 ${className}`}
      style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT}aa)`, color: "#060c18" }}
    >
      <Save className="w-4 h-4" />
      {saving ? "Saving…" : "Save Configuration"}
    </button>
  );

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">NLP Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Project NLP configuration{activeProjectName && <span> · {activeProjectName}</span>}
          </p>
        </div>
        <SaveButton />
      </div>

      {saveMsg && (
        <div
          className="mb-6 rounded-xl p-4 text-sm"
          style={
            saveMsg.ok
              ? { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }
              : { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }
          }
        >
          {saveMsg.ok ? "✅ " : "⚠️ "}{saveMsg.text}
        </div>
      )}

      {loading ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          Loading configuration…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Info banner */}
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: "rgba(0,201,255,0.06)", border: "1px solid rgba(0,201,255,0.15)", color: "#00c9ff" }}
          >
            These dictionaries are pre-filled with the full base vocabulary. You can <strong>add extra words</strong> — the engine always uses BASE + your additions. Clearing a field reverts it to the base on the next save.
          </div>

          {/* Brand handle */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Brand Handle</p>
            <input
              type="text"
              value={brandHandle}
              onChange={(e) => setBrandHandle(e.target.value)}
              placeholder="cimory"
              className="w-48 px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">Without @ — used to detect brand tag mentions in comments.</p>
          </div>

          {/* 3-column keyword text areas */}
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-4">Keyword Dictionaries</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Column A */}
              <div className="space-y-4">
                {[
                  { label: "Product Keywords",    val: productKw,    set: setProductKw,    help: "Adds to base — never replaces." },
                  { label: "Influencer Keywords", val: influencerKw, set: setInfluencerKw, help: "" },
                  { label: "Intent Keywords",     val: intentKw,     set: setIntentKw,     help: "" },
                  { label: "Health Keywords",     val: healthKw,     set: setHealthKw,     help: "" },
                ].map(({ label, val, set, help }) => (
                  <div key={label} className="space-y-1">
                    <label className="block text-xs font-semibold text-muted-foreground">{label}</label>
                    {help && <p className="text-xs text-muted-foreground opacity-70">{help}</p>}
                    <textarea
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      rows={5}
                      className={textareaCls}
                    />
                  </div>
                ))}
              </div>

              {/* Column B */}
              <div className="space-y-4">
                {[
                  { label: "Positive Words",          val: positiveKw, set: setPositiveKw, help: "Adds to base." },
                  { label: "Negative Words",          val: negativeKw, set: setNegativeKw, help: "Adds to base." },
                  { label: "Negation & Intensifiers", val: negationKw, set: setNegationKw, help: "" },
                  { label: "Spam Phrases",            val: spamKw,     set: setSpamKw,     help: "" },
                ].map(({ label, val, set, help }) => (
                  <div key={label} className="space-y-1">
                    <label className="block text-xs font-semibold text-muted-foreground">{label}</label>
                    {help && <p className="text-xs text-muted-foreground opacity-70">{help}</p>}
                    <textarea
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      rows={5}
                      className={textareaCls}
                    />
                  </div>
                ))}
              </div>

              {/* Column C */}
              <div className="space-y-4">
                {[
                  { label: "Positive Emojis", val: posEmoji,   set: setPosEmoji,   help: "" },
                  { label: "Negative Emojis", val: negEmoji,   set: setNegEmoji,   help: "" },
                  { label: "Reaction Words",  val: reactionKw, set: setReactionKw, help: "" },
                ].map(({ label, val, set, help }) => (
                  <div key={label} className="space-y-1">
                    <label className="block text-xs font-semibold text-muted-foreground">{label}</label>
                    {help && <p className="text-xs text-muted-foreground opacity-70">{help}</p>}
                    <textarea
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      rows={4}
                      className={textareaCls}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* PR Crisis tracking table */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">PR Crisis Tracking</p>
              <p className="text-xs text-muted-foreground mt-1">
                An alert fires if any <strong>Exact Phrase</strong> appears, OR if a <strong>Keyword</strong> AND a <strong>Trigger</strong> both appear together in the same comment. Add one row per alert.
              </p>
            </div>
            <EditableTable
              columns={["Alert Name", "Exact Phrases", "Keywords", "Triggers"]}
              rows={prRows}
              onChange={setPrRows}
              columnHelp={{
                "Exact Phrases": "comma-separated, e.g. 33%, 33 persen",
                "Keywords":      "e.g. kandungan, komposisi",
                "Triggers":      "e.g. dikit, sedikit, cuma, air",
              }}
            />
          </div>

          {/* Theme + Slang tables side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Theme Map</p>
                <p className="text-xs text-muted-foreground mt-1">Theme → keyword triggers (comma-separated).</p>
              </div>
              <EditableTable
                columns={["Theme", "Keywords"]}
                rows={themeRows}
                onChange={setThemeRows}
              />
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Slang / Typo Map</p>
                <p className="text-xs text-muted-foreground mt-1">Slang or typos → canonical form.</p>
              </div>
              <EditableTable
                columns={["Original", "Replacement"]}
                rows={slangRows}
                onChange={setSlangRows}
              />
            </div>
          </div>

          {/* Bottom save button */}
          <div className="flex items-center gap-3 pb-4">
            <SaveButton className="px-6 py-2.5" />
          </div>
        </div>
      )}
    </div>
  );
}
