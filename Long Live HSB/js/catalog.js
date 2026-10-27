(function (App) {
  'use strict';

  const C = App.CONFIG;
  const U = App.Util;

  function variant(id, name, color) { return { id: id, name: name, color: color }; }

  function seedProduct(data) {
    return {
      id: data.id,
      name: data.name,
      category: data.category,
      price: data.price,
      widthCm: data.widthCm,
      lengthCm: data.lengthCm,
      heightCm: data.heightCm,
      description: data.description || '',
      brand: data.brand || C.COMPANY_NAME,
      materials: data.materials || '',
      availability: data.availability || 'In stock',
      variants: data.variants || [],
      assets: { main: null, display: null, top: null, glb: null },
      modelRotationDeg: 0,
      demo: true,
      source: 'demo'
    };
  }

  const SEED_PRODUCTS = [
    seedProduct({
      id: 'BED-001', name: 'Aurora Upholstered Bed', category: 'bed', price: 1299,
      widthCm: 160, lengthCm: 200, heightCm: 110,
      description: 'A calm, upholstered double bed with a soft channel-stitched headboard and a low profile. Fits a standard 160 × 200 cm mattress.',
      materials: 'Oak frame, recycled polyester upholstery, foam',
      variants: [variant('sand', 'Sand fabric', '#cbb79f'), variant('slate', 'Slate fabric', '#8b948f'), variant('forest', 'Forest fabric', '#5d7a63')]
    }),
    seedProduct({
      id: 'BED-002', name: 'Nordic Oak Single Bed', category: 'bed', price: 649,
      widthCm: 90, lengthCm: 200, heightCm: 90,
      description: 'A compact solid-oak single bed with a slatted base and a simple spindle headboard.',
      materials: 'Solid oak, plywood slats',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'WRD-001', name: 'Oslo Three-Door Wardrobe', category: 'wardrobe', price: 1099,
      widthCm: 150, lengthCm: 60, heightCm: 220,
      description: 'A tall three-door wardrobe with an adjustable shelf and hanging rail. Requires 60 cm clearance for door access.',
      materials: 'Oak veneer, MDF, powder-coated steel handles',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'WRD-002', name: 'Lina Sliding Wardrobe', category: 'wardrobe', price: 1399,
      widthCm: 180, lengthCm: 62, heightCm: 230,
      description: 'Space-efficient sliding doors with a full-height mirror panel on one side.',
      materials: 'Oak veneer, MDF, mirror glass',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('ash', 'Smoked ash', '#8f8274')]
    }),
    seedProduct({
      id: 'SOF-001', name: 'Haven Three-Seater Sofa', category: 'sofa', price: 1199,
      widthCm: 220, lengthCm: 92, heightCm: 85,
      description: 'A deep three-seater with feather-blend cushions and a low, relaxed back.',
      materials: 'FSC beech frame, feather-blend cushions, wool weave',
      variants: [variant('moss', 'Moss wool', '#8ba08c'), variant('oat', 'Oat weave', '#d3c5b0'), variant('charcoal', 'Charcoal weave', '#6d7471')]
    }),
    seedProduct({
      id: 'SOF-002', name: 'Nook Loveseat', category: 'sofa', price: 799,
      widthCm: 160, lengthCm: 85, heightCm: 82,
      description: 'A compact two-seater designed for snugger rooms and reading corners.',
      materials: 'FSC beech frame, pocket springs, wool weave',
      variants: [variant('moss', 'Moss wool', '#8ba08c'), variant('oat', 'Oat weave', '#d3c5b0')]
    }),
    seedProduct({
      id: 'CHR-001', name: 'Pebble Armchair', category: 'chair', price: 449,
      widthCm: 82, lengthCm: 82, heightCm: 78,
      description: 'A rounded lounge chair with a sculpted foam seat and a swivel base.',
      materials: 'Moulded foam, steel base, bouclé fabric',
      variants: [variant('cream', 'Cream bouclé', '#ddd5c6'), variant('sage', 'Sage bouclé', '#9aab99')]
    }),
    seedProduct({
      id: 'CHR-002', name: 'Form Dining Chair', category: 'chair', price: 129,
      widthCm: 46, lengthCm: 52, heightCm: 86,
      description: 'A sturdy dining chair with a formed plywood shell and tapered oak legs.',
      materials: 'Plywood shell, solid oak legs',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('black', 'Black stain', '#43433f')]
    }),
    seedProduct({
      id: 'TBL-001', name: 'Union Coffee Table', category: 'table', price: 349,
      widthCm: 120, lengthCm: 60, heightCm: 40,
      description: 'A low rectangular coffee table with a rounded-edge oak top and two storage shelves.',
      materials: 'Solid oak, oak veneer',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('walnut', 'Walnut stain', '#7d5a42')]
    }),
    seedProduct({
      id: 'TBL-002', name: 'Gather Dining Table', category: 'table', price: 699,
      widthCm: 160, lengthCm: 90, heightCm: 75,
      description: 'A six-seat dining table with a solid oak top and a slim, architectural base.',
      materials: 'Solid oak, powder-coated steel',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('black', 'Black ash', '#4a4842')]
    }),
    seedProduct({
      id: 'DSK-001', name: 'Studio Writing Desk', category: 'desk', price: 499,
      widthCm: 140, lengthCm: 70, heightCm: 75,
      description: 'A clean-lined work desk with two discreet drawers and a cable channel.',
      materials: 'Oak veneer, solid oak legs, steel runners',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'SHF-001', name: 'Profile Bookcase', category: 'shelf', price: 329,
      widthCm: 90, lengthCm: 34, heightCm: 180,
      description: 'A slim, open bookcase with five adjustable oak shelves.',
      materials: 'Oak veneer, powder-coated steel',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('sage', 'Sage frame', '#7d9382')]
    }),
    seedProduct({
      id: 'STG-001', name: 'Tuck Nightstand', category: 'storage', price: 149,
      widthCm: 45, lengthCm: 40, heightCm: 55,
      description: 'A small bedside cabinet with one drawer and an open cubby.',
      materials: 'Oak veneer, solid oak legs',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'STG-002', name: 'Ridge Six-Drawer Dresser', category: 'storage', price: 599,
      widthCm: 110, lengthCm: 45, heightCm: 80,
      description: 'A wide chest of drawers with soft-close runners and a chamfered edge.',
      materials: 'Oak veneer, MDF, steel runners',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('walnut', 'Walnut stain', '#7d5a42')]
    }),
    seedProduct({
      id: 'STG-003', name: 'Line Media Console', category: 'storage', price: 549,
      widthCm: 180, lengthCm: 40, heightCm: 45,
      description: 'A low media console with routed cable vents and push-latch doors.',
      materials: 'Oak veneer, MDF, steel legs',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('black', 'Black ash', '#4a4842')]
    }),
    seedProduct({
      id: 'LGT-001', name: 'Arc Floor Lamp', category: 'lighting', price: 199,
      widthCm: 35, lengthCm: 35, heightCm: 165,
      description: 'A slim floor lamp with a height-adjustable linen shade and weighted base.',
      materials: 'Steel, linen shade, marble base',
      variants: [variant('linen', 'Natural linen', '#d8c8a8'), variant('graphite', 'Graphite', '#555a57')]
    }),
    seedProduct({
      id: 'RUG-001', name: 'Meadow Wool Rug', category: 'rug', price: 399,
      widthCm: 200, lengthCm: 300, heightCm: 1,
      description: 'A hand-tufted wool rug in a soft, tonal meadow pattern. Rugs sit beneath furniture and do not obstruct placement.',
      materials: '100% wool, cotton backing',
      variants: [variant('sage', 'Sage', '#aebea6'), variant('sand', 'Sand', '#d7c9b4')]
    }),
    seedProduct({
      id: 'DCR-001', name: 'Fern Planter', category: 'decor', price: 89,
      widthCm: 50, lengthCm: 50, heightCm: 120,
      description: 'A potted indoor fern in a hand-glazed stoneware planter.',
      materials: 'Stoneware, live fern',
      variants: [variant('white', 'White glaze', '#e2ddd2'), variant('clay', 'Clay glaze', '#b58f73')]
    }),
    seedProduct({
      id: 'BED-003', name: 'Marlow King Bed', category: 'bed', price: 1899,
      widthCm: 180, lengthCm: 210, heightCm: 115,
      description: 'A generous king-size bed with a wide, winged headboard and a solid oak base. Takes a 180 × 200 cm mattress.',
      materials: 'Solid oak, wool blend upholstery, pocket springs',
      variants: [variant('oat', 'Oat weave', '#d3c5b0'), variant('slate', 'Slate weave', '#8b948f'), variant('clay', 'Clay weave', '#c0a08c')]
    }),
    seedProduct({
      id: 'WRD-003', name: 'Cedar Two-Door Wardrobe', category: 'wardrobe', price: 899,
      widthCm: 100, lengthCm: 58, heightCm: 210,
      description: 'A compact two-door wardrobe for smaller bedrooms, with one hanging rail and three drawers.',
      materials: 'Cedar veneer, MDF, brushed brass handles',
      variants: [variant('cedar', 'Natural cedar', '#b98d63'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'SOF-003', name: 'Atlas Modular Sectional', category: 'sofa', price: 2399,
      widthCm: 300, lengthCm: 180, heightCm: 78,
      description: 'A deep L-shaped sectional built from two modules, with a chaise that can sit on either end.',
      materials: 'FSC hardwood frame, high-resilience foam, performance weave',
      variants: [variant('oat', 'Oat weave', '#d3c5b0'), variant('moss', 'Moss wool', '#8ba08c'), variant('graphite', 'Graphite weave', '#6d7471')]
    }),
    seedProduct({
      id: 'SOF-004', name: 'Cove Chaise Sofa', category: 'sofa', price: 1499,
      widthCm: 240, lengthCm: 100, heightCm: 82,
      description: 'A three-seater with an integrated chaise, designed for long evenings and reading corners.',
      materials: 'FSC beech frame, feather-blend cushions, bouclé weave',
      variants: [variant('cream', 'Cream bouclé', '#ddd5c6'), variant('sage', 'Sage bouclé', '#9aab99')]
    }),
    seedProduct({
      id: 'CHR-003', name: 'Haven Lounge Chair', category: 'chair', price: 599,
      widthCm: 76, lengthCm: 84, heightCm: 80,
      description: 'A low lounge chair with a wide seat, a gently reclined back and solid oak feet.',
      materials: 'Moulded foam, solid oak, wool weave',
      variants: [variant('oat', 'Oat weave', '#d3c5b0'), variant('forest', 'Forest weave', '#5d7a63')]
    }),
    seedProduct({
      id: 'CHR-004', name: 'Rivet Counter Stool', category: 'chair', price: 189,
      widthCm: 43, lengthCm: 50, heightCm: 66,
      description: 'A counter-height stool with a footrest and a contoured seat for kitchen islands.',
      materials: 'Solid ash, powder-coated steel',
      variants: [variant('ash', 'Natural ash', '#c2a582'), variant('black', 'Black stain', '#43433f')]
    }),
    seedProduct({
      id: 'CHR-005', name: 'Pebble Ottoman', category: 'chair', price: 299,
      widthCm: 80, lengthCm: 60, heightCm: 42,
      description: 'A soft rectangular ottoman that works as a footrest, an extra seat or a coffee-table stand-in.',
      materials: 'Hardwood frame, foam, bouclé fabric',
      variants: [variant('cream', 'Cream bouclé', '#ddd5c6'), variant('clay', 'Clay bouclé', '#c0a08c')]
    }),
    seedProduct({
      id: 'TBL-003', name: 'Round Dining Table', category: 'table', price: 749,
      widthCm: 120, lengthCm: 120, heightCm: 75,
      description: 'A round four-seat dining table with a chamfered edge and a central pedestal base.',
      materials: 'Solid oak, powder-coated steel',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'TBL-004', name: 'Nest Side Table', category: 'table', price: 179,
      widthCm: 45, lengthCm: 45, heightCm: 52,
      description: 'A small round side table that tucks beside a sofa or bed without crowding the room.',
      materials: 'Oak veneer, solid oak legs',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('walnut', 'Walnut stain', '#7d5a42')]
    }),
    seedProduct({
      id: 'DSK-002', name: 'Corner Studio Desk', category: 'desk', price: 629,
      widthCm: 160, lengthCm: 120, heightCm: 75,
      description: 'An L-shaped corner desk with a cable tray and a monitor shelf, sized for a home office corner.',
      materials: 'Oak veneer, steel frame, MDF',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('black', 'Black ash', '#4a4842')]
    }),
    seedProduct({
      id: 'SHF-002', name: 'Cube Wall Shelf', category: 'shelf', price: 249,
      widthCm: 80, lengthCm: 28, heightCm: 90,
      description: 'A wall-mounted cube shelf with three open compartments for books and display objects.',
      materials: 'Oak veneer, MDF',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'STG-004', name: 'Haven Shoe Cabinet', category: 'storage', price: 279,
      widthCm: 90, lengthCm: 35, heightCm: 60,
      description: 'A slim hallway cabinet with two tilted shoe drawers and a top shelf for keys and post.',
      materials: 'Oak veneer, MDF, steel runners',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'STG-005', name: 'Oak Sideboard', category: 'storage', price: 799,
      widthCm: 160, lengthCm: 45, heightCm: 80,
      description: 'A wide sideboard with four doors, an adjustable shelf and cable cut-outs for media equipment.',
      materials: 'Solid oak, oak veneer, brass handles',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('smoked', 'Smoked oak', '#8f8274')]
    }),
    seedProduct({
      id: 'LGT-002', name: 'Glow Table Lamp', category: 'lighting', price: 129,
      widthCm: 30, lengthCm: 30, heightCm: 50,
      description: 'A compact table lamp with a warm diffused shade for bedside and desk lighting.',
      materials: 'Ceramic base, linen shade, brass fittings',
      variants: [variant('sand', 'Sand ceramic', '#d7c9b4'), variant('graphite', 'Graphite ceramic', '#555a57')]
    }),
    seedProduct({
      id: 'LGT-003', name: 'Halo Pendant Light', category: 'lighting', price: 249,
      widthCm: 40, lengthCm: 40, heightCm: 30,
      description: 'A ring pendant light that throws an even glow over a dining table or kitchen island.',
      materials: 'Aluminium, frosted acrylic diffuser',
      variants: [variant('white', 'Chalk white', '#e5e2da'), variant('black', 'Matte black', '#3d3f3c')]
    }),
    seedProduct({
      id: 'RUG-002', name: 'Dune Jute Rug', category: 'rug', price: 299,
      widthCm: 160, lengthCm: 230, heightCm: 1,
      description: 'A flat-woven jute rug with a natural, textured finish. Rugs sit beneath furniture and do not obstruct placement.',
      materials: '100% jute',
      variants: [variant('natural', 'Natural jute', '#cbb893'), variant('bleached', 'Bleached jute', '#ded5c2')]
    }),
    seedProduct({
      id: 'DCR-002', name: 'Arc Wall Mirror', category: 'decor', price: 219,
      widthCm: 80, lengthCm: 4, heightCm: 180,
      description: 'A full-height arched mirror that adds light and depth to narrow rooms.',
      materials: 'Glass, powder-coated steel frame',
      variants: [variant('brass', 'Brushed brass', '#b99a6b'), variant('black', 'Matte black', '#3d3f3c')]
    }),
    seedProduct({
      id: 'DCR-003', name: 'Ceramic Vase Trio', category: 'decor', price: 69,
      widthCm: 30, lengthCm: 30, heightCm: 45,
      description: 'Three hand-thrown stoneware vases in graduated heights for shelves and sideboards.',
      materials: 'Glazed stoneware',
      variants: [variant('sand', 'Sand glaze', '#d7c9b4'), variant('olive', 'Olive glaze', '#8b9475')]
    }),
    seedProduct({
      id: 'DOR-001', name: 'Shaker Interior Door', category: 'door', price: 249,
      widthCm: 90, lengthCm: 12, heightCm: 210,
      description: 'A solid-core interior door with a classic five-panel shaker face. Added products open a real doorway in the wall.',
      materials: 'Engineered timber core, oak veneer',
      variants: [variant('white', 'Painted white', '#efece5'), variant('oak', 'Natural oak', '#b4936b')]
    }),
    seedProduct({
      id: 'DOR-002', name: 'Glazed Sliding Door', category: 'door', price: 649,
      widthCm: 180, lengthCm: 12, heightCm: 220,
      description: 'A wide sliding door with a slim frame and a single glazed panel, ideal between living and dining rooms.',
      materials: 'Aluminium frame, tempered glass',
      variants: [variant('black', 'Matte black', '#3d3f3c'), variant('steel', 'Brushed steel', '#9aa0a6')]
    }),
    seedProduct({
      id: 'WIN-001', name: 'Casement Window', category: 'window', price: 399,
      widthCm: 120, lengthCm: 12, heightCm: 120,
      description: 'A side-hinged casement window with a 90 cm sill. Added products open a real window opening in the wall.',
      materials: 'Timber frame, double glazing',
      variants: [variant('white', 'Painted white', '#efece5'), variant('oak', 'Natural oak', '#b4936b')]
    }),
    seedProduct({
      id: 'WIN-002', name: 'Panoramic Window', category: 'window', price: 899,
      widthCm: 240, lengthCm: 12, heightCm: 150,
      description: 'A wide fixed picture window with slim mullions to frame a view. Sill height 60 cm.',
      materials: 'Aluminium frame, double glazing',
      variants: [variant('black', 'Matte black', '#3d3f3c'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'STR-001', name: 'Straight Oak Staircase', category: 'staircase', price: 1890,
      widthCm: 90, lengthCm: 280, heightCm: 280,
      description: 'A straight oak staircase with 14 open risers and a slim handrail. Place it like any other catalog product.',
      materials: 'Solid oak treads, steel stringers',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('white', 'Chalk white', '#e5e2da')]
    }),
    seedProduct({
      id: 'STR-002', name: 'Space-Saver Stair', category: 'staircase', price: 1490,
      widthCm: 80, lengthCm: 180, heightCm: 280,
      description: 'A compact alternating-tread staircase for tight corners and loft conversions.',
      materials: 'Solid ash treads, powder-coated steel',
      variants: [variant('ash', 'Natural ash', '#c2a582'), variant('black', 'Black steel', '#43433f')]
    }),
    seedProduct({
      id: 'STR-003', name: 'L-Shaped Staircase', category: 'staircase', price: 2190,
      widthCm: 100, lengthCm: 220, heightCm: 280,
      description: 'An L-shaped staircase with a quarter-landing, suiting a hallway that turns the corner.',
      materials: 'Solid oak treads, oak handrail, steel stringers',
      variants: [variant('oak', 'Natural oak', '#b4936b'), variant('smoked', 'Smoked oak', '#8f8274')]
    })
  ];

  const catalogState = {
    ready: false,
    seed: SEED_PRODUCTS,
    custom: [],
    overrides: [],
    products: [],
    byId: {},
    lastError: null
  };

  function normalizeText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max || 500);
  }

  function normalizeNumber(value) {
    if (value === '' || value == null) return NaN;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function normalizeAssetRef(ref) {
    if (!ref || typeof ref !== 'object' || !ref.key) return null;
    return {
      key: String(ref.key),
      name: normalizeText(ref.name, 160) || 'asset',
      type: normalizeText(ref.type, 80) || 'application/octet-stream'
    };
  }

  function normalizeVariants(list) {
    if (!Array.isArray(list)) return [];
    const used = {};
    return list.map(function (entry, index) {
      if (!entry || !entry.name) return null;
      let id = normalizeText(entry.id || entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 40) || ('variant-' + index);
      if (used[id]) id = id + '-' + (index + 1);
      used[id] = true;
      return {
        id: id,
        name: normalizeText(entry.name, 60),
        color: U.isHexColor(entry.color) ? entry.color : '#b9b2a4'
      };
    }).filter(Boolean);
  }

  function normalizeProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const category = normalizeText(raw.category, 40);
    const variants = normalizeVariants(raw.variants);
    const assets = raw.assets && typeof raw.assets === 'object' ? raw.assets : {};
    return {
      id: normalizeText(raw.id, 48),
      name: normalizeText(raw.name, 120),
      category: category,
      price: raw.price == null || raw.price === '' ? null : Number(raw.price),
      widthCm: Number(raw.widthCm),
      lengthCm: Number(raw.lengthCm),
      heightCm: Number(raw.heightCm),
      description: normalizeText(raw.description, 1200),
      brand: normalizeText(raw.brand, 120),
      materials: normalizeText(raw.materials, 300),
      availability: normalizeText(raw.availability, 120),
      variants: variants,
      assets: {
        main: normalizeAssetRef(assets.main),
        display: normalizeAssetRef(assets.display),
        top: normalizeAssetRef(assets.top),
        glb: normalizeAssetRef(assets.glb)
      },
      modelRotationDeg: U.normalizeDeg(Number(raw.modelRotationDeg) || 0),
      demo: !!raw.demo,
      source: raw.source === 'custom' ? 'custom' : (raw.demo ? 'demo' : 'custom')
    };
  }

  function validateProductData(product, allProducts) {
    const errors = [];
    const warnings = [];
    if (!product || typeof product !== 'object') {
      return { errors: ['Product data is missing.'], warnings: [] };
    }
    if (!product.id) errors.push('A unique product ID is required.');
    else if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,47}$/.test(product.id)) errors.push('Product ID may only contain letters, numbers, hyphens and underscores (2–48 characters).');
    if (!product.name) errors.push('A product name is required.');
    if (!product.category || !C.CATEGORIES[product.category]) errors.push('Choose a valid product category.');
    if (!U.isFiniteNumber(product.price) || product.price < 0) errors.push('Price must be a valid number of zero or greater.');
    ['widthCm', 'lengthCm', 'heightCm'].forEach(function (key) {
      const label = key === 'widthCm' ? 'Width' : key === 'lengthCm' ? 'Length' : 'Height';
      if (!U.isFiniteNumber(product[key]) || product[key] <= 0) errors.push(label + ' must be a positive number in centimetres.');
    });
    if (U.isFiniteNumber(product.heightCm) && product.heightCm > 400) warnings.push('Height above 400 cm is unusual for home furniture.');
    if (!Array.isArray(product.variants)) warnings.push('Variants should be a list.');
    if (allProducts) {
      const duplicate = allProducts.find(function (p) { return p && p.id === product.id && p !== product && p.__originalId !== product.id; });
      if (duplicate && product.__isNew) errors.push('Product ID "' + product.id + '" is already used.');
    }
    return { errors: errors, warnings: warnings };
  }

  function isUniqueId(id, exceptId, currentList) {
    return !currentList.some(function (p) { return p.id === id && p.id !== exceptId; });
  }

  function rebuild() {
    const merged = [];
    const byId = {};
    const sourceById = {};
    seedSource().forEach(function (p) {
      if (!byId[p.id]) { merged.push(p); byId[p.id] = p; sourceById[p.id] = 'demo'; }
    });
    catalogState.overrides.forEach(function (p) {
      if (!p || !p.id) return;
      if (!byId[p.id]) return;
      const index = merged.findIndex(function (m) { return m.id === p.id; });
      const base = merged[index];
      const normalized = normalizeProduct(Object.assign({}, base, p, { demo: true, source: 'demo' }));
      merged[index] = normalized;
      byId[p.id] = normalized;
    });
    catalogState.custom.forEach(function (p) {
      if (!p || !p.id) return;
      if (byId[p.id]) return;
      merged.push(p);
      byId[p.id] = p;
    });
    catalogState.products = merged;
    catalogState.byId = byId;
    catalogState.ready = true;
  }

  function seedSource() {
    return SEED_PRODUCTS.map(function (p) { return normalizeProduct(p); });
  }

  async function init() {
    let meta = null;
    try {
      meta = await App.Storage.loadCatalogMeta();
    } catch (err) {
      catalogState.lastError = err;
    }
    const custom = [];
    const overrides = [];
    if (meta && meta.custom && Array.isArray(meta.custom)) {
      meta.custom.forEach(function (raw) {
        const normalized = normalizeProduct(raw);
        if (!normalized) return;
        const validation = validateProductData(normalized);
        if (validation.errors.length) {
          console.warn('Skipping an invalid stored custom product:', normalized.id, validation.errors);
          return;
        }
        custom.push(Object.assign(normalized, { source: 'custom', demo: false }));
      });
    }
    if (meta && meta.overrides && Array.isArray(meta.overrides)) {
      const seedIds = {};
      seedSource().forEach(function (p) { seedIds[p.id] = true; });
      meta.overrides.forEach(function (raw) {
        const normalized = normalizeProduct(raw);
        if (!normalized || !seedIds[normalized.id]) return;
        const validation = validateProductData(normalized);
        if (validation.errors.length) {
          console.warn('Skipping an invalid stored product override:', normalized.id, validation.errors);
          return;
        }
        overrides.push(Object.assign(normalized, { demo: true, source: 'demo' }));
      });
    }
    catalogState.custom = custom;
    catalogState.overrides = overrides;
    rebuild();
    // Surface malformed stored records but keep the app running.
    if (catalogState.lastError) console.warn('Catalog storage warning:', catalogState.lastError);
    return getProducts();
  }

  function getProducts() { return catalogState.products.slice(); }
  function getProductsById() { return catalogState.byId; }
  function getProduct(id) { return catalogState.byId[id] || null; }

  function getCategories() {
    return Object.keys(C.CATEGORIES).map(function (key) {
      return { id: key, label: C.CATEGORIES[key].label, color: C.CATEGORIES[key].color };
    });
  }

  function getCategoryLabel(categoryId) {
    return C.CATEGORIES[categoryId] ? C.CATEGORIES[categoryId].label : 'Uncategorised';
  }

  function getCategoryColor(categoryId) {
    return C.CATEGORIES[categoryId] ? C.CATEGORIES[categoryId].color : '#b9b2a4';
  }

  function variantFor(product, variantId) {
    if (!product || !product.variants || !product.variants.length) return null;
    return product.variants.find(function (v) { return v.id === variantId; }) || product.variants[0];
  }

  function defaultVariantId(product) {
    const v = variantFor(product, null);
    return v ? v.id : null;
  }

  function colorFor(product, variantId) {
    const v = variantFor(product, variantId);
    return v && v.color ? v.color : getCategoryColor(product ? product.category : '');
  }

  function hasGlbModel(product) {
    return !!(product && product.assets && product.assets.glb && product.assets.glb.key);
  }

  /* Retailer-created products without a GLB get the named black placeholder,
     while the curated demo range keeps its built-in models. */
  function usesFallback(product) {
    return !!product && !hasGlbModel(product) && product.source === 'custom';
  }

  function structuralKind(product) {
    if (!product) return null;
    if (product.category === 'door') return 'door';
    if (product.category === 'window') return 'window';
    return null;
  }

  function nextCustomId() {
    let index = 1;
    let id;
    do {
      id = 'CUSTOM-' + String(index).padStart(3, '0');
      index++;
    } while (catalogState.byId[id]);
    return id;
  }

  async function persistMeta() {
    return App.Storage.saveCatalogMeta({
      version: 1,
      custom: catalogState.custom.map(function (p) { return U.deepClone(p); }),
      overrides: catalogState.overrides.map(function (p) { return U.deepClone(p); })
    });
  }

  async function upsertProduct(rawProduct, options) {
    const opts = options || {};
    const normalized = normalizeProduct(rawProduct);
    if (!normalized) throw new Error('Invalid product data.');
    const isSeed = !!catalogState.seed.find(function (p) { return p.id === normalized.id; });
    const existing = catalogState.byId[normalized.id];
    if (opts.isNew && existing) throw new Error('Product ID "' + normalized.id + '" is already used.');
    if (isSeed && !opts.allowSeedOverride) {
      throw new Error('Product ID "' + normalized.id + '" belongs to the demo catalog. Open that product and edit it to customise it.');
    }
    normalized.__isNew = !existing;
    const validation = validateProductData(normalized);
    if (validation.errors.length) {
      const error = new Error(validation.errors[0]);
      error.details = validation.errors;
      throw error;
    }
    delete normalized.__isNew;
    if (isSeed) {
      normalized.demo = true;
      normalized.source = 'demo';
      const existingIndex = catalogState.overrides.findIndex(function (p) { return p.id === normalized.id; });
      if (existingIndex >= 0) catalogState.overrides[existingIndex] = normalized;
      else catalogState.overrides.push(normalized);
    } else {
      normalized.demo = false;
      normalized.source = 'custom';
      const existingIndex = catalogState.custom.findIndex(function (p) { return p.id === normalized.id; });
      if (existingIndex >= 0) catalogState.custom[existingIndex] = normalized;
      else {
        if (!isUniqueId(normalized.id, normalized.id, catalogState.products)) throw new Error('That product ID is already in use.');
        catalogState.custom.push(normalized);
      }
    }
    rebuild();
    const persistence = await persistMeta();
    return { product: getProduct(normalized.id), persistence: persistence };
  }

  async function deleteCustomProduct(id) {
    const index = catalogState.custom.findIndex(function (p) { return p.id === id; });
    if (index < 0) return false;
    const assets = catalogState.custom[index].assets || {};
    Object.keys(assets).forEach(function (key) {
      if (assets[key] && assets[key].key) {
        App.Storage.deleteAsset(assets[key].key).catch(function () {});
      }
    });
    catalogState.custom.splice(index, 1);
    rebuild();
    await persistMeta();
    return true;
  }

  async function resetSeedProduct(id) {
    const index = catalogState.overrides.findIndex(function (p) { return p.id === id; });
    if (index < 0) return false;
    const removed = catalogState.overrides[index];
    const assets = removed.assets || {};
    catalogState.overrides.splice(index, 1);
    rebuild();
    await persistMeta();
    Object.keys(assets).forEach(function (key) {
      if (assets[key] && assets[key].key) App.Storage.deleteAsset(assets[key].key).catch(function () {});
    });
    return true;
  }

  function countCustom() { return catalogState.custom.length; }
  function countOverrides() { return catalogState.overrides.length; }
  function isSeedOverridden(id) { return catalogState.overrides.some(function (p) { return p.id === id; }); }

  App.Catalog = {
    init: init,
    getProducts: getProducts,
    getProductsById: getProductsById,
    getProduct: getProduct,
    getCategories: getCategories,
    getCategoryLabel: getCategoryLabel,
    getCategoryColor: getCategoryColor,
    variantFor: variantFor,
    defaultVariantId: defaultVariantId,
    colorFor: colorFor,
    hasGlbModel: hasGlbModel,
    usesFallback: usesFallback,
    structuralKind: structuralKind,
    validateProductData: validateProductData,
    normalizeProduct: normalizeProduct,
    upsertProduct: upsertProduct,
    deleteCustomProduct: deleteCustomProduct,
    resetSeedProduct: resetSeedProduct,
    nextCustomId: nextCustomId,
    countCustom: countCustom,
    countOverrides: countOverrides,
    isSeedOverridden: isSeedOverridden,
    SEED_PRODUCTS: SEED_PRODUCTS
  };
})(window.App = window.App || {});
