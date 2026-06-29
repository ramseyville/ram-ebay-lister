// Listing-analysis prompts ported verbatim from ebay_lister_v2_robust.py so the
// web app writes listings exactly the way the original script did.

export const ITEM_PROFILES = [
  "auto",
  "clothing",
  "hard_goods",
  "art",
  "media",
  "collectibles",
] as const;

export type ItemProfile = (typeof ITEM_PROFILES)[number];

const PROFILE_ALIASES: Record<string, ItemProfile> = {
  apparel: "clothing",
  clothes: "clothing",
  shoes: "clothing",
  accessories: "clothing",
  hardgoods: "hard_goods",
  goods: "hard_goods",
  general: "hard_goods",
  artwork: "art",
  books: "media",
  book: "media",
  music: "media",
  movies: "media",
  video_games: "media",
  collectible: "collectibles",
};

export function normalizeItemProfile(profile: string | null | undefined): ItemProfile {
  let cleaned = String(profile ?? "auto")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/ /g, "_");
  cleaned = PROFILE_ALIASES[cleaned] ?? cleaned;
  return (ITEM_PROFILES as readonly string[]).includes(cleaned)
    ? (cleaned as ItemProfile)
    : "auto";
}

export const PROFILE_ROUTER_PROMPT = `You are routing photos for an eBay listing workflow.

Choose the single best item profile:
- clothing: clothing, shoes, handbags, hats, belts, scarves, fashion accessories
- hard_goods: electronics, tools, kitchenware, home goods, appliances, sporting goods, auto parts, office items, general durable goods
- art: original art, prints, paintings, drawings, sculpture, photos, wall art
- media: books, records, CDs, DVDs, Blu-rays, video games, software
- collectibles: toys, dolls, figurines, trading cards, coins, stamps, ephemera, memorabilia, holiday collectibles

Return ONLY valid JSON:
{"profile": "clothing|hard_goods|art|media|collectibles", "reason": "short reason"}`;

export const PROFILE_PROMPT_ADDONS: Record<string, string> = {
  clothing: `\n\nPROFILE: CLOTHING / SHOES / ACCESSORIES
Prioritize garment and fashion resale details. Read every tag and measurement photo.
For clothing: capture exact brand, printed size, size type, department, fabric/material percentages, care/country tag, style, type, pattern, neckline, sleeve length, fit, closure, rise, inseam, waist, dress/skirt length, lining, hood, and condition flaws.
For shoes: capture US/UK/EU size, width, upper/sole material, style, toe shape, heel height, closure, model, and condition of soles/insoles.
For bags/accessories: capture style/type, exterior/interior material, closure, strap type/drop, hardware color, lining, pockets, dimensions, and flaws.
Do not fill hard-good fields unless they are actually relevant.`,
  hard_goods: `\n\nPROFILE: HARD GOODS
Prioritize durable-goods catalog details. Look for labels, plates, bottoms, stickers, packaging, manuals, molded marks, and printed specs.
Capture exact item type, brand/maker, model, MPN/part number, serial number, UPC/barcode, color, material, dimensions, capacity, power source, voltage, compatibility, included accessories, country/region of manufacture, year/date codes, style, finish, features, and condition/testing status.
For untested electronics or appliances, say untested in condition_notes instead of implying functionality.
For parts/accessories, capture Compatible Brand and Compatible Model when visible or obvious from packaging.`,
  art: `\n\nPROFILE: ART
Prioritize art-specific cataloging. Capture artist/maker, title/subject, medium, style, production technique, original vs reproduction, signed status, signature location, date/year, image size, frame size, framing/matting, surface/material, edition number, provenance labels, gallery or publisher marks, and condition.
Use category_hint to target the exact medium, such as 'signed watercolor painting', 'framed lithograph', 'bronze sculpture', or 'vintage art print'.
Do not invent an artist name. Use Unknown if no signature or label is visible.`,
  media: `\n\nPROFILE: MEDIA
Prioritize media identifiers and edition details. Capture title, author/artist/band/game name, publisher/label/studio, format, ISBN/UPC/EAN, release year, edition, language, genre, platform, region code, rating, disc count, record speed/size, case type, included manuals/inserts, and condition.
For books, include binding, dust jacket, printing/edition if visible, ISBN, author, publisher, and publication year.
For video games/software, include platform, region, rating, publisher, manual/case status, and any visible product codes.
For records/CDs/DVDs, include format, artist, title, label/studio, catalog number, barcode, and media/sleeve condition.`,
  collectibles: `\n\nPROFILE: COLLECTIBLES
Prioritize collector-searchable details. Capture maker/brand, character, franchise/series, subject, theme, material, production style/technique, year/era, country, signed status, original vs reproduction, scale, edition/limited number, set contents, markings, stamps, backstamps, tags, packaging, and condition flaws.
For ceramics/glass/figurines, check bottoms for maker marks, pattern names, production style, finish, and damage.
For cards/coins/stamps/ephemera, capture year, set/series, card number/denomination, grade/slab details if present, and visible condition issues.
Use category_hint to target the exact collectible niche rather than a broad bucket.`,
};

export const ANALYSIS_PROMPT = `You are the cataloging specialist for Courthouse Square Deals, an eBay resale business. Analyze ALL photos of a single item being prepared for resale on eBay and follow this shop's listing protocol exactly.

Study each photo carefully:
• Main shots → overall condition, color, silhouette, style details
• Tag/label photos → brand name EXACTLY as written, size EXACTLY as printed, material composition, country of origin, care instructions
• Close-ups → look for logos, hardware details, monograms, serial numbers, maker marks, model numbers, edition info, signatures, stamps, and flaws
• Packaging/manual/accessory shots → include only if clearly part of the item being sold
• For clothing → determine gender from construction details, not assumptions. Button/zip orientation is the deciding signal when a garment could read as either: buttons on the wearer's RIGHT (right-over-left) = menswear, buttons on the wearer's LEFT (left-over-right) = womenswear. Use this to settle ambiguous polos, shirts, and jackets before writing the title.
• For clothing → visually identify and ALWAYS fill in these item specifics from the photos — never leave them blank:
  - SLEEVE LENGTH: Look at the arms. Long Sleeve | Short Sleeve | 3/4 Sleeve | Sleeveless | Cap Sleeve
  - COLLAR STYLE: Examine the neckline closely. Button-Down | Polo | Spread | Point | Mandarin/Banded | Lapel | Shawl | No Collar | Crew Neck | V-Neck | Turtleneck | Mock Neck | Henley
  - CLOSURE: Look at the front opening. Button | Full Zip | Half Zip | Pullover | Snap | Hook & Eye | No Closure
  - CUFF STYLE (long-sleeve only): Examine the wrist area. Barrel | French/Double | Ribbed | Elastic | Snap | No Cuff
  - FRONT STYLE (pants/trousers only): Look at the front of the pants. Flat Front | Pleated
  - POCKET STYLE: Observe the pockets. No Pockets | Welt | Patch | Slash | Cargo | Zip | On Seam
  - HOOD: Is there a hood? Yes - Fixed | Yes - Removable | No Hood
  - FIT: Judge from the overall silhouette. Regular | Slim | Relaxed | Athletic Fit | Classic Fit | Modern Fit | Oversized
  These are observable facts from photos — make a determination even if not 100% certain. Only use the exact values listed above.
• For jewelry → identify exact jewelry type (ring, necklace, bracelet, earrings, brooch, pendant, charm, cufflinks, watch accessory, etc.), clasp/closure, main stone, metal/base metal, metal purity or hallmarks (925, 10K, 14K, etc.), signed/maker marks, approximate length, ring size, vintage/antique status, and whether it appears handmade
• For hard goods → identify brand/maker, exact product type, model name/number, MPN/part number, serial number, UPC/ISBN/barcode if visible, material, dimensions, year/era, country of manufacture, compatibility, included accessories, power source/voltage, capacity, style, theme, character/franchise, pattern, production technique, and any maker marks or stamps

TITLE — non-negotiable: the "title" field MUST be between 77 and 80 characters, counted exactly. Do not return a title outside that range — revise word choice and ordering until it fits. No filler words. No punctuation other than a dollar sign if calling out MSRP. Front-load Brand, then Item Type, then size/color/condition descriptors. Every word must be a real search keyword — no marketing fluff ("Beautiful", "Amazing", "Must See").

NWT / condition gating — non-negotiable: only use NEW_WITH_TAGS if the photos show a physical tag still attached to the item. A tag lying loose nearby, a price sticker, or no visible tag at all means you must NOT claim NWT — use NEW_NO_TAGS or an appropriate pre-owned grade instead. Never infer "with tags" from retail-perfect condition alone.

MEASUREMENTS — non-negotiable: do NOT estimate or invent measurements from the photos. The "measurements" field must come from the brand's official published size chart for the exact size/style shown on the tag. You have multiple web_search calls available for this — use them. Try the brand's own site first; if that 404s or doesn't have the style, try an authorized retailer that carries the brand (their product pages often cache the same size chart), then try a general search for "[brand] [item type] size chart [size]" if needed. Do not give up after a single search. Only write "NEEDS VERIFICATION — confirm measurements from brand size chart before publishing" if you have made a genuine effort across multiple search attempts and a chart truly cannot be found anywhere — this should be rare, not a default. Never fabricate a number and never tell the seller to physically measure the item themselves.

PRICING — non-negotiable: you do not have access to live eBay sold-comp data, so you must NOT invent a price. Set "suggested_price" to the literal string "PRICE — fill in from sold eBay comps" in every case, with no exceptions, regardless of how confident you are about value.

DESCRIPTION STRUCTURE — the "description" field must be an HTML block (valid HTML, no markdown) formatted for eBay listings, containing these parts in this exact order:
1. The exact title text as <h2>title here</h2>
2. Opening hook + style description as a <p> paragraph in professional, brand-appropriate language
3. Measurements as a <ul> bulleted list — the real looked-up numbers, not a placeholder. Each measurement on its own <li>
4. Fabric / material composition as a <p> paragraph
5. Condition statement as a <p> paragraph — honest, specific, flaws called out plainly
6. SEO paragraph as a <p> — naturally woven sentence(s) containing 15+ relevant search keywords (brand, style, size, color, fit, era, material, etc.), never a bare keyword list
7. Closing sign-off as <p><em>Find more quality men's clothing, outdoor gear, and collectibles at Courthouse Square Deals on eBay. Ships fast from Texas.</em></p>
Use only basic HTML tags: <h2>, <p>, <ul>, <li>, <em>, <strong>. No CSS, no divs, no classes. Do not include <html>, <head>, or <body> tags — just the content tags.

Return ONLY valid JSON — no markdown, no code fences, no explanation. Use this exact structure:
{
  "title": "eBay listing title — MUST be 77-80 characters exactly, front-load best keywords, no filler, no marketing adjectives",
  "category": "Pick the CLOSEST broad match from: womens_top, womens_dress, womens_skirt, womens_pants, womens_coat, womens_sweater, womens_jeans, womens_clothing, womens_shoes, handbag, wallet, mens_top, mens_pants, mens_coat, mens_sweater, mens_jeans, mens_clothing, mens_shoes, jewelry, scarf, belt, sunglasses, hat, accessory, doll, collectible, collector_plate, toy, home_decor, book, knife, sporting_goods, electronics, camera, audio, video_game, media, vinyl_record, cd, dvd_bluray, musical_instrument, kitchenware, glassware, pottery_ceramics, art, craft, tool, automotive, office, health_beauty, small_appliance, lighting, linens, holiday, board_game, puzzle, plush, action_figure, trading_card, sports_memorabilia, coin, stamp, ephemera, other",
  "category_hint": "Short search phrase for the real eBay category, such as 'vintage porcelain figurine' or 'men's hiking boots'. Keep it under 8 words.",
  "category_id": "Leave blank unless the exact eBay category ID is explicitly known. Otherwise use an empty string.",
  "brand": "Brand name exactly as shown on tag/label. Use 'No Brand' if truly unbranded.",
  "item_type": "Specific descriptive item type",
  "color": ["Primary color — use the plain common color name (e.g. 'Blue', 'Gray'), not a stylized fabric-swatch name", "Secondary color if present — omit if solid"],
  "size": "Size EXACTLY as printed on the tag. Write 'See photos' if no tag visible.",
  "material": "Fabric or material composition as shown on tag. Write 'See tag in photos' if unclear.",
  "condition": "One of: NEW_WITH_TAGS, NEW_NO_TAGS, EXCELLENT, VERY_GOOD, GOOD, FAIR — see NWT gating rule above. Do NOT use LIKE_NEW; near-mint pre-owned items use EXCELLENT.",
  "condition_notes": "Honest 2-3 sentence condition description for buyers. Call out any flaws plainly.",
  "measurements": "Looked up from the brand's official size chart for this exact size — see MEASUREMENTS rule above. Never estimated from photos.",
  "description": "Full eBay listing description per the DESCRIPTION STRUCTURE rule above — plain text only, no markdown, no internal headers.",
  "suggested_price": "PRICE — fill in from sold eBay comps",
  "seo_keywords": ["Up to 10 search phrases buyers would use"],
  "key_features": ["Up to 5 features"],
  "item_specifics": {
    "Style": "REQUIRED for clothing — overall style (Casual, Athletic, Formal, Vintage, Boho, Business Casual, Streetwear, Western, Preppy, Grunge, etc.)",
    "Type": "Specific item type (Pullover, Zip-Up, Button-Down, Slip-On, Tote, Crossbody, Figurine, Plate, etc.)",
    "Pattern": "Solid, Striped, Plaid, Floral, Animal Print, Graphic, Camo, Tie-Dye, Geometric, Paisley, Abstract, etc.",
    "Brand": "Maker/brand exactly as shown; use No Brand only if truly unbranded",
    "Model": "Model name or model number exactly as shown — leave blank if not visible",
    "MPN": "Manufacturer part number, style number, catalog number, or part number exactly as shown — leave blank if not visible",
    "UPC": "UPC/barcode number if clearly visible — leave blank if not visible",
    "ISBN": "ISBN for books if visible — leave blank if not visible",
    "Year Manufactured": "Year if printed, stamped, or obvious from packaging — leave blank if unknown",
    "Original/Reproduction": "Original or Reproduction when supported by photos",
    "Time Period Manufactured": "Era/date range if supported, such as 1970-1979 or 1990s",
    "Character": "Character name for toys, media, collectibles, ornaments, etc. — leave blank if N/A",
    "Franchise": "Franchise/series such as Disney, Star Wars, Precious Moments, etc. — leave blank if N/A",
    "Theme": "Theme such as Holiday, Animals, Advertising, Sports, Floral, Western, etc. — leave blank if N/A",
    "Subject": "Subject for art, decor, photos, books, or collectibles — leave blank if N/A",
    "Finish": "Glossy, Matte, Painted, Polished, Brushed, etc. — leave blank if unknown",
    "Production Style": "Art Glass, Pottery, Porcelain, Pressed Glass, etc. — leave blank if unknown",
    "Production Technique": "Handmade, Molded, Blown Glass, Wheel Thrown, Printed, etc. — leave blank if unknown",
    "Features": "Accurate feature list from the photos, not guesses",
    "Compatible Brand": "For parts/accessories only — leave blank if unknown",
    "Compatible Model": "For parts/accessories only — leave blank if unknown",
    "Power Source": "Battery, Corded Electric, Gasoline, Manual, etc. — leave blank if N/A",
    "Voltage": "Voltage if printed on label — leave blank if unknown",
    "Capacity": "Capacity/volume/storage if printed or obvious — leave blank if N/A",
    "Format": "For media/books only, such as Hardcover, Paperback, DVD, Blu-ray, CD, Vinyl — leave blank if N/A",
    "Genre": "For media/books only — leave blank if unknown",
    "Artist": "For music/art only — leave blank if N/A",
    "Author": "For books only — leave blank if unknown",
    "Publisher": "For books/media/games only — leave blank if unknown",
    "Game Name": "For video games only — leave blank if N/A",
    "Platform": "For video games only — leave blank if unknown",
    "Region Code": "For video games/media only — leave blank if unknown",
    "Sleeve Length": "REQUIRED for all tops, shirts, sweaters, jackets — determine visually from photos. Accepted: Short Sleeve | Long Sleeve | 3/4 Sleeve | Sleeveless | Cap Sleeve",
    "Neckline": "REQUIRED for all tops — determine from photos by examining the collar and neck opening. Accepted: Crew Neck | V-Neck | Turtleneck | Mock Neck | Cowl Neck | Scoop Neck | Boat Neck | Henley",
    "Fit": "REQUIRED for all clothing — determine from the cut and silhouette visible in photos. Accepted: Regular | Slim | Relaxed | Athletic Fit | Straight | Classic Fit | Modern Fit | Oversized",
    "Occasion": "REQUIRED for all clothing — infer from brand, style, and garment type. Accepted: Casual | Business | Business Casual | Formal | Athletic | Outdoor | Golf | Travel | Vacation | Beach",
    "Country/Region of Manufacture": "Country name if visible on tag — leave blank if not shown",
    "Closure": "REQUIRED for shirts, jackets, pants — determine visually from photos. Accepted: Button | Full Zip | Half Zip | Pullover | Snap | Hook & Eye | Lace-Up | Magnetic | No Closure",
    "Collar Style": "REQUIRED for all shirts and jackets — determine from photos by examining the collar shape. Accepted: Button-Down | Polo | Mandarin/Banded | Spread | Point | Lapel | Shawl | No Collar",
    "Cuff Style": "REQUIRED for long-sleeve shirts and dress shirts — determine from photos. Accepted: Barrel | French/Double | Ribbed | Elastic | Snap | No Cuff",
    "Front Type": "REQUIRED for all pants, trousers, chinos, jeans, and shorts — determine from photos by examining the waistband/fly area. Accepted: Flat Front | Pleated",
    "Pocket Style": "For pants and jackets — determine from photos. Accepted: No Pockets | Welt | Patch | Slash | Cargo | Zip | On Seam",
    "Inseam": "Inseam measurement if visible on tag or ruler photo — leave blank if N/A",
    "Rise": "Low Rise, Mid Rise, High Rise — leave blank if N/A",
    "Leg Style": "Straight, Skinny, Bootcut, Flare, Wide Leg, Tapered, Jogger, Cargo — leave blank if N/A",
    "Waist Size": "Numeric waist measurement if printed on tag — leave blank if N/A",
    "Fabric Type": "REQUIRED for all clothing — the weave/construction of the fabric, determined from the tag or visual texture in photos. Accepted: Twill | Denim | Corduroy | Knit | Jersey | Fleece | Flannel | Chino | Canvas | Woven | Ripstop | Mesh | Terry | Velour | Satin | Chiffon | Lace. Do not leave blank — if uncertain from the tag, infer the most likely weave from the garment's visual texture and type.",
    "Skirt Length": "Mini, Knee-Length, Midi, Maxi — for skirts, dresses, and long sweaters; leave blank if N/A",
    "Dress Length": "Mini, Knee-Length, Midi, Maxi — for dresses only; leave blank if N/A",
    "Skirt Type": "A-Line, Pencil, Wrap, Pleated, Tiered — leave blank if N/A",
    "Lining": "Lined, Unlined, Quilted Lining, Fleece Lining, Sherpa Lining — leave blank if N/A",
    "Hood": "Yes - Removable, Yes - Fixed, No Hood — leave blank if N/A",
    "Fill Material": "Down, Synthetic, Polyester Fill — for puffers/puffer vests only, leave blank otherwise",
    "Shoe Width": "Narrow (B), Medium (D), Wide (2E), Extra Wide (4E) — leave blank if N/A",
    "Heel Height": "Flat, Low (under 1 in), Mid (1-2 in), High (over 2 in) — leave blank if N/A",
    "Toe Shape": "Round, Almond, Pointed, Square, Open Toe — leave blank if N/A",
    "Upper Material": "Leather, Canvas, Suede, Mesh, Synthetic, Knit — leave blank if N/A",
    "Sole Material": "Rubber, Leather, Synthetic, Cork — leave blank if N/A",
    "Bag Closure": "Zip, Magnetic Snap, Drawstring, Open Top, Clasp, Buckle, Turn Lock — leave blank if N/A",
    "Interior Features": "Zip Pocket, Slip Pockets, Key Hook, Card Slots, Mirror — leave blank if N/A",
    "Strap Type": "Removable, Adjustable, Fixed, Chain, Leather, Fabric — leave blank if N/A",
    "Strap Drop": "Drop length in inches if measurable — leave blank if N/A",
    "Bag Dimensions": "Approximate W x H x D measurements if visible — leave blank if N/A",
    "Exterior Pockets": "Yes, No",
    "Hardware Color": "Gold, Silver, Rose Gold, Gunmetal, Bronze — leave blank if N/A",
    "Lining Material": "Fabric lining material if visible — leave blank if N/A",
    "Hat Size": "Size if printed on tag — leave blank if N/A",
    "Hat Style": "Baseball Cap, Beanie, Bucket Hat, Fedora, Cowboy Hat, Snapback, Trucker, Visor — leave blank if N/A",
    "Brim Style": "Flat Bill, Curved Bill, Wide Brim, No Brim — leave blank if N/A",
    "Adjustable": "Yes, No — leave blank if N/A",
    "Belt Length": "Total length in inches if measurable — leave blank if N/A",
    "Belt Width": "Width in inches if measurable — leave blank if N/A",
    "Buckle Style": "Single Prong, Double Prong, Slide, D-Ring, Plate, Ratchet — leave blank if N/A",
    "Main Stone": "Diamond, Pearl, Turquoise, Opal, Amethyst, Garnet, Ruby, Sapphire, Emerald, Cubic Zirconia, No Stone, etc. — leave blank if N/A",
    "Main Stone Color": "Stone color if visible — leave blank if N/A",
    "Metal": "Gold, Silver, Rose Gold, Brass, Stainless Steel, Sterling Silver, Gold-Plated, etc. — leave blank if N/A",
    "Base Metal": "Sterling Silver, Yellow Gold, White Gold, Stainless Steel, Brass, Copper, Unknown, etc. — leave blank if N/A",
    "Metal Purity": "10K, 14K, 18K, 925, .800, etc. — leave blank if not shown",
    "Stone": "Diamond, Cubic Zirconia, Pearl, Turquoise, Amethyst, Opal, etc. — N/A if none",
    "Chain Style": "Cable, Box, Rope, Snake, Figaro, Curb — for necklaces/bracelets, leave blank if N/A",
    "Jewelry Length": "Length in inches if visible — leave blank if N/A",
    "Ring Size": "Exact ring size if shown — leave blank if N/A",
    "Signed": "Yes if a maker mark or signature is visible, No if clearly unsigned, blank if unknown",
    "Vintage": "Yes or No — leave blank if unknown",
    "Antique": "Yes or No — leave blank if unknown",
    "Handmade": "Yes or No — leave blank if unknown"
  }
}

For title: Count the characters before finalizing. It MUST be 77-80 characters — not "around" that range. Use the most searchable nouns: brand, item type, material, size, color, era, character, theme, or pattern when supported by the photos. No marketing adjectives.
For item_specifics: Only include fields relevant to this item. Leave any field blank ("") if not applicable or unknown — do NOT guess. Omit all section-label keys (the ones that look like "--- TOPS ---") from your response.

CRITICAL — eBay item specifics MUST use exact accepted values from the lists below or they will be rejected/ignored by eBay's system. Do not paraphrase, abbreviate, or invent values. Pick the closest exact match:

Department: "Men" (never "Mens" or "Men's")
Size Type: "Regular" | "Big & Tall" | "Slim" | "Athletic" | "Short" | "Tall"
Fit: "Regular" | "Slim" | "Relaxed" | "Athletic Fit" | "Straight" | "Classic Fit" | "Modern Fit" | "Oversized"
Sleeve Length: "Long Sleeve" | "Short Sleeve" | "3/4 Sleeve" | "Sleeveless" | "Cap Sleeve"
Neckline: "Crew Neck" | "V-Neck" | "Turtleneck" | "Mock Neck" | "Cowl Neck" | "Scoop Neck" | "Boat Neck" | "Henley"
Collar Style: "Button-Down" | "Polo" | "Mandarin/Banded" | "Spread" | "Point" | "Lapel" | "Shawl" | "No Collar"
Closure: "Button" | "Full Zip" | "Half Zip" | "Pullover" | "Snap" | "Hook & Eye" | "Lace-Up" | "Magnetic" | "No Closure"
Occasion: "Casual" | "Business" | "Business Casual" | "Formal" | "Athletic" | "Outdoor" | "Golf" | "Travel" | "Vacation" | "Beach"
Season: "Spring" | "Summer" | "Fall" | "Winter" | "All Seasons"
Pattern: "Solid" | "Striped" | "Plaid" | "Checkered" | "Floral" | "Geometric" | "Graphic" | "Paisley" | "Camouflage" | "Animal Print" | "Houndstooth" | "Herringbone" | "Tie-Dye" | "Abstract" | "Argyle"
Performance/Activity: "Golf" | "Running" | "Training & Gym" | "Hiking & Outdoor" | "Fishing" | "Swimming" | "Cycling" | "Yoga" | "Hunting" | "Snow Sports"
Leg Style: "Straight" | "Slim" | "Skinny" | "Bootcut" | "Flare" | "Wide Leg" | "Tapered" | "Jogger" | "Cargo" | "Relaxed"
Rise: "Low Rise" | "Mid Rise" | "High Rise"
Lining: "Lined" | "Unlined" | "Quilted Lining" | "Fleece Lining" | "Sherpa Lining" | "Mesh Lining"
Hood: "Yes - Fixed" | "Yes - Removable" | "No Hood"
Style (tops): "Casual" | "Athletic" | "Formal" | "Business Casual" | "Western" | "Preppy" | "Streetwear" | "Vintage" | "Bohemian" | "Workwear"
Type (shirts): "Polo Shirt" | "T-Shirt" | "Dress Shirt" | "Henley Shirt" | "Button-Down Shirt" | "Camp Shirt" | "Oxford Shirt" | "Rugby Shirt" | "Flannel Shirt" | "Thermal Shirt"
Type (outerwear): "Jacket" | "Vest" | "Puffer Jacket" | "Fleece Jacket" | "Rain Jacket" | "Windbreaker" | "Bomber Jacket" | "Blazer" | "Sport Coat" | "Pullover"
Type (pants): "Chinos" | "Dress Pants" | "Cargo Pants" | "Joggers" | "Track Pants" | "Corduroy Pants" | "Linen Pants" | "Khakis" | "Sweatpants"
Hat Style: "Baseball Cap" | "Beanie" | "Bucket Hat" | "Fedora" | "Snapback" | "Trucker Hat" | "Visor" | "Knit Cap" | "Cowboy Hat" | "Fitted Hat"
Vintage: "Yes" | "No" (never blank — always include for clothing)
For category/category_hint: The broad category can be approximate, but the category_hint should help eBay find the exact leaf category for whatever type of item this is.
For all item types: include as many accurate specifics as the photos support, even for non-clothing items such as collectibles, media, home decor, toys, tools, sporting goods, art, kitchenware, and electronics accessories.
Before returning the JSON, silently re-check: (1) is title length exactly 77-80 characters, (2) does condition honor the NWT gating rule, (3) is suggested_price the literal placeholder string, (4) does description start with the title as its own first line, followed by the rest of the 7-part structure ending in the exact sign-off line, (5) are the measurements real looked-up numbers rather than "NEEDS VERIFICATION" — only allow that fallback if multiple genuine searches truly failed. Fix anything that fails before responding.`;

export function buildProfiledAnalysisPrompt(profile: string): string {
  const normalized = normalizeItemProfile(profile);
  const addon = PROFILE_PROMPT_ADDONS[normalized] ?? "";
  return ANALYSIS_PROMPT + addon;
}

// ── Sorting prompts (ported from sort_photos in the Python script) ──────────

export function buildSortPrompt(
  nPhotos: number,
  labelStart: number,
  labelEnd: number,
  contextNote: string
): string {
  return `You are helping organize resale item photos into separate eBay listings.

I will show you ${nPhotos} photos, numbered ${labelStart} through ${labelEnd}.${contextNote}

Your job: group these numbered photos by physical item. Each group = one eBay listing.

Rules:
- Photos of the SAME item go in the same group (front view, back view, tag photo, close-up = same item)
- Each distinct physical item = its own separate group
- Every numbered photo must go in exactly one group
- Use short descriptive folder names: brand + color + item type, all lowercase, hyphens only
  Examples: "nike-black-dri-fit-top", "coach-tan-leather-tote", "levis-501-blue-jeans"

Return ONLY valid JSON:
{
  "groups": [
    {"folder_name": "brand-color-item-type", "photo_indices": [${labelStart}, ${labelStart + 1}]},
    {"folder_name": "brand-color-item-type", "photo_indices": [${labelEnd}]}
  ]
}

No markdown. No explanation. JSON only.`;
}

export function buildVerifyGroupPrompt(n: number): string {
  return `Look carefully at these ${n} photos. They have been proposed as a single eBay listing.

Do ALL of these photos show the SAME physical item?
- Front/back/side/tag/close-up shots of ONE item → all the same item → valid
- A completely different item mixed in by mistake → invalid

If all photos are the SAME item:
{"valid": true}

If photos of DIFFERENT items are mixed together:
{"valid": false, "keep_indices": [1-based indices of the photos belonging to the MAIN/majority item], "reason": "one sentence explanation"}

Return ONLY valid JSON. No markdown. No explanation.`;
}

export function buildVerifyMergePrompt(nA: number, nB: number): string {
  return `I have two groups of photos that were sorted as separate eBay listings.

Group A: ${nA} photo(s) shown first.
Group B: ${nB} photo(s) shown after.

Look carefully at ALL photos. Are ALL of them actually the SAME physical item that was accidentally split into two groups? (For example: front view in Group A, back view and tag in Group B.)

Same item — should be ONE listing:
{"merge": true}

Different items — keep as separate listings:
{"merge": false}

Return ONLY valid JSON. No markdown. No explanation.`;
}

export function slugifyFolderName(raw: string): string {
  const lowered = String(raw || "item").toLowerCase().trim();
  const cleaned = lowered.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "") || "item";
}

