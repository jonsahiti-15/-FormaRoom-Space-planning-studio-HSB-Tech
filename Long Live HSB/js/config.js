(function (App) {
  'use strict';

  const CATEGORIES = {
    bed: { label: 'Beds', color: '#c8b59c', placement: 'wall' },
    wardrobe: { label: 'Wardrobes', color: '#b9c4bb', placement: 'wall' },
    sofa: { label: 'Sofas', color: '#9fb5a8', placement: 'wall' },
    chair: { label: 'Chairs', color: '#c2ad94', placement: 'free' },
    table: { label: 'Tables', color: '#c9a97e', placement: 'center' },
    desk: { label: 'Desks', color: '#b9a88f', placement: 'wall' },
    shelf: { label: 'Shelving', color: '#aebeb2', placement: 'wall' },
    storage: { label: 'Storage', color: '#b7b0a3', placement: 'wall' },
    lighting: { label: 'Lighting', color: '#d8c28c', placement: 'free' },
    rug: { label: 'Rugs', color: '#cdb9a0', placement: 'center' },
    decor: { label: 'Decor', color: '#9fbfa8', placement: 'free' },
    staircase: { label: 'Staircases', color: '#b8a488', placement: 'free' },
    door: { label: 'Doors', color: '#b08d6b', placement: 'wall' },
    window: { label: 'Windows', color: '#a9c4cc', placement: 'wall' }
  };

  App.CONFIG = {
    APP_NAME: 'FormaRoom',
    APP_VERSION: '1.3.0',
    COMPANY_ID: 'northline-demo',
    COMPANY_NAME: 'Northline Living',
    DEMO_CATALOG: true,
    CM_TO_M: 0.01,
    WALL_THICKNESS_CM: 12,
    SNAP_CM: 5,
    DEFAULT_BUDGET: 2500,

    WALL_DEFAULT_COLOR: '#f2f0ea',
    WALL_COLORS: [
      { id: 'warm-white', label: 'Warm white', value: '#f2f0ea' },
      { id: 'oat', label: 'Oat', value: '#e6dbc8' },
      { id: 'mist', label: 'Mist', value: '#d4dde0' },
      { id: 'sage', label: 'Sage', value: '#ccd8c8' },
      { id: 'clay', label: 'Clay', value: '#d9c0ad' },
      { id: 'stone', label: 'Stone', value: '#d3d1ca' },
      { id: 'olive', label: 'Olive', value: '#b8bea3' },
      { id: 'terracotta', label: 'Terracotta', value: '#c99b81' }
    ],

    FLOOR_DEFAULT_COLOR: '#e8e3d9',
    FLOOR_COLORS: [
      { id: 'porcelain', label: 'Porcelain', value: '#e8e3d9' },
      { id: 'white', label: 'White', value: '#f5f4f0' },
      { id: 'light-grey', label: 'Light grey', value: '#cfcdc7' },
      { id: 'mid-grey', label: 'Mid grey', value: '#a7a49c' },
      { id: 'charcoal', label: 'Charcoal', value: '#57534c' },
      { id: 'sand', label: 'Sand', value: '#d9cbb2' },
      { id: 'oak', label: 'Oak', value: '#c3a276' },
      { id: 'walnut', label: 'Walnut', value: '#7a5a3e' },
      { id: 'ebony', label: 'Ebony', value: '#3c332b' }
    ],
    FLOOR_TEXTURE: {
      MIN_SCALE_M: 0.25,
      MAX_SCALE_M: 8,
      DEFAULT_SCALE_M: 1,
      MAX_BYTES: 8 * 1024 * 1024,
      ACCEPT: 'image/png,image/jpeg'
    },

    ROOM: {
      MIN_DIM_CM: 200,
      MAX_DIM_CM: 1500,
      MIN_HEIGHT_CM: 200,
      MAX_HEIGHT_CM: 400,
      DEFAULT_WIDTH_CM: 400,
      DEFAULT_LENGTH_CM: 500,
      DEFAULT_HEIGHT_CM: 280
    },

    LIMITS: {
      MAX_PLACED_ITEMS: 60,
      MAX_AI_SELECTION: 30,
      MAX_GLB_MODELS: 24,
      MAX_IMAGE_BYTES: 6 * 1024 * 1024,
      MAX_GLB_BYTES: 40 * 1024 * 1024,
      CATEGORY_LIMITS: {
        bed: 4,
        wardrobe: 6,
        sofa: 4,
        chair: 12,
        table: 6,
        desk: 4,
        shelf: 8,
        storage: 8,
        lighting: 10,
        rug: 4,
        decor: 20,
        staircase: 3,
        door: 12,
        window: 12
      }
    },

    STRUCTURAL: {
      MIN_WALL_MARGIN_CM: 0,
      OPENING_GAP_CM: 5,
      DOOR: { label: 'Door', defaultWidthCm: 90, defaultHeightCm: 210, minWidthCm: 60, maxWidthCm: 180, minHeightCm: 160, maxHeightCm: 260, sillCm: 0 },
      WINDOW: { label: 'Window', defaultWidthCm: 120, defaultHeightCm: 120, minWidthCm: 40, maxWidthCm: 320, minHeightCm: 40, maxHeightCm: 220, defaultSillCm: 90 },
      DOOR_SWING_DEPTH_CM: 100,
      DOOR_STYLES: {
        single: { id: 'single', label: 'Single door', description: 'A single hinged leaf with a handle and swing arc.' },
        double: { id: 'double', label: 'Double door', description: 'Two hinged leaves meeting in the middle.' },
        sliding: { id: 'sliding', label: 'Sliding door', description: 'A sliding leaf with a top track, no swing.' },
        glazed: { id: 'glazed', label: 'Glazed door', description: 'Single door with a large glazed panel.' },
        panel: { id: 'panel', label: 'Panel door', description: 'A single door with recessed timber panels.' }
      },
      WINDOW_STYLES: {
        fixed: { id: 'fixed', label: 'Fixed window', description: 'A fixed picture window with minimal frame.' },
        sliding: { id: 'sliding', label: 'Sliding window', description: 'Two horizontal sashes with a centre meeting rail.' },
        casement: { id: 'casement', label: 'Casement window', description: 'Side-hinged casements with visible handles.' },
        double: { id: 'double', label: 'Double-hung window', description: 'Two vertically stacked sashes.' },
        panoramic: { id: 'panoramic', label: 'Panoramic window', description: 'A wide floor-to-sill glass pane with slim mullions.' }
      },
      DEFAULT_DOOR_STYLE: 'single',
      DEFAULT_WINDOW_STYLE: 'fixed'
    },

    ROOM_USES: {
      living: {
        id: 'living',
        label: 'Living room',
        description: 'Sofa, coffee table, media storage and lighting.'
      },
      bedroom: {
        id: 'bedroom',
        label: 'Bedroom',
        description: 'Bed, bedside storage, wardrobe and lighting.'
      },
      office: {
        id: 'office',
        label: 'Home office',
        description: 'Desk, task seating, shelving and storage.'
      },
      dining: {
        id: 'dining',
        label: 'Dining room',
        description: 'Dining table, chairs, sideboard and lighting.'
      }
    },

    TEMPLATES: {
      balanced: {
        id: 'balanced',
        label: 'Balanced',
        description: 'Even distribution with sensible walkways and balanced open space.'
      },
      wall: {
        id: 'wall',
        label: 'Wall-Focused',
        description: 'Pushes storage and large pieces to the walls, keeping the middle open.'
      },
      center: {
        id: 'center',
        label: 'Center-Focused',
        description: 'Groups conversational pieces toward the middle with perimeter circulation.'
      },
      space: {
        id: 'space',
        label: 'Space-Saving',
        description: 'Compact, tight groupings that prioritise usable floor area and clear doors.'
      }
    },

    HIGHLIGHT: '#0f7a52',

    HOME: {
      MAX_ROOMS: 24,
      MAX_LINKS: 40,
      MAX_HOME_ITEMS: 320,
      SNAP_CM: 10,
      PACK_GAP_CM: 20,
      PACK_PAGE_CM: 2600,
      LINK_COLOR: '#0f7a52',
      ROOM_FILLS: {
        living: '#e4eee6',
        bedroom: '#efe6dc',
        office: '#e3e9ef',
        dining: '#eee7dd',
        other: '#eceae4'
      }
    },

    STORAGE: {
      DB_NAME: 'formaroom-storage',
      CURRENT_KEY: 'formaroom.current.v1',
      DESIGNS_KEY: 'formaroom.designs.v1',
      CATALOG_KEY: 'formaroom.catalog.v1',
      PREF_KEY: 'formaroom.prefs.v1',
      HOME_KEY: 'formaroom.home.v1'
    },

    CATEGORIES: CATEGORIES,

    CATEGORY_PADDING_CM: {
      bed: 12,
      wardrobe: 10,
      sofa: 10,
      chair: 3,
      table: 6,
      desk: 8,
      shelf: 6,
      storage: 6,
      lighting: 3,
      rug: 0,
      decor: 3,
      staircase: 0,
      door: 0,
      window: 0
    }
  };
})(window.App = window.App || {});
