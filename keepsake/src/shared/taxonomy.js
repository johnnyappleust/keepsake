// Default collections. These are intelligent defaults, not rigid requirements:
// the categorizer matches against whatever collections the user actually has
// and only proposes one of these when nothing similar exists.
//
// `keywords` are matched as whole words/phrases in product text. A trailing
// `*` allows a prefix match (e.g. "lamp*" matches lamp, lamps, lampshade).
// `strong` keywords are near-unambiguous and lift confidence on their own.

export const INBOX_KEY = 'inbox';

export const DEFAULT_TAXONOMY = [
  {
    key: 'camping',
    name: 'Camping & Outdoors',
    description: 'Tents, sleeping bags, stoves, packs, hiking and campsite gear.',
    color: '#6F8F6A',
    aliases: ['camping', 'outdoors', 'outdoor', 'hiking', 'backpacking', 'camp gear', 'outdoor gear', 'adventure'],
    strong: ['tent', 'tents', 'sleeping bag', 'sleeping pad', 'camp stove', 'camping stove', 'backpacking stove', 'firepit', 'fire pit', 'campfire', 'headlamp', 'bivy', 'tarp shelter', 'trekking pole*', 'hiking pole*', 'camp chair', 'camping chair', 'camping lantern', 'hammock', 'cooler', 'bear canister', 'water filter', 'carabiner', 'paracord', 'rain fly', 'rainfly', 'backpacking'],
    keywords: ['camp*', 'hik*', 'trail', 'trekking', 'backpack', 'daypack', 'outdoor*', 'wilderness', 'expedition', 'summit', 'alpine', 'mountaineering', 'climbing', 'kayak*', 'canoe', 'fishing', 'lantern', 'thermos', 'insulated bottle', 'multi-tool', 'multitool', 'survival', 'fire starter', 'ferro rod', 'compass', 'binoculars', 'rooftop tent', 'ground tarp', 'dry bag', 'bug net', 'mosquito', 'sleeping quilt', 'down quilt', 'stove fuel', 'isobutane', 'propane', 'cookset', 'mess kit', 'spork', 'titanium mug', 'gaiters', 'snowshoe*', 'ski*', 'snowboard*'],
  },
  {
    key: 'home',
    name: 'Home Decor',
    description: 'Lighting, furniture, rugs, mirrors, art, plants and the things that make a room.',
    color: '#B9924F',
    aliases: ['home', 'decor', 'home decor', 'interior', 'interiors', 'furniture', 'living room', 'bedroom', 'apartment', 'house', 'homewares', 'home goods'],
    strong: ['lamp', 'lamps', 'table lamp', 'floor lamp', 'bedside lamp', 'desk lamp', 'pendant light', 'chandelier', 'sconce', 'rug', 'rugs', 'area rug', 'mirror', 'wall art', 'art print', 'framed print', 'throw pillow', 'cushion cover', 'armchair', 'sofa', 'couch', 'loveseat', 'sectional', 'coffee table', 'side table', 'nightstand', 'bookshelf', 'bookcase', 'sideboard', 'credenza', 'dresser', 'headboard', 'bed frame', 'ottoman', 'vase', 'candle holder', 'planter', 'curtain*', 'duvet cover', 'bedding', 'wallpaper', 'lampshade', 'ceiling light', 'wall sconce', 'lounge chair', 'dining chair', 'dining table', 'bar stool', 'counter stool', 'console table'],
    keywords: ['lamp*', 'light*', 'lighting', 'chair', 'stool', 'table', 'shelf', 'shelving', 'cabinet', 'bench', 'throw', 'blanket', 'pillow', 'cushion', 'decor*', 'decorative', 'ceramic', 'vase', 'candle', 'frame', 'poster', 'print', 'canvas', 'tapestry', 'clock', 'plant', 'planter', 'pot', 'linen', 'velvet', 'boucle', 'rattan', 'oak', 'walnut', 'teak', 'mid-century', 'midcentury', 'scandinavian', 'bohemian', 'boho', 'interior', 'furniture', 'sofa', 'mattress', 'sheet set', 'quilt', 'comforter', 'doormat', 'basket', 'tray', 'bookend*', 'sculpture', 'figurine', 'wall hook*', 'coat rack', 'dimmer', 'bulb', 'murano', 'glass shade'],
  },
  {
    key: 'clothing',
    name: 'Clothing',
    description: 'Shoes, jackets, tops, pants, dresses, accessories and everything you wear.',
    color: '#8B6F8F',
    aliases: ['clothes', 'clothing', 'apparel', 'fashion', 'wardrobe', 'outfits', 'style', 'shoes', 'footwear', 'accessories', 'wear', 'menswear', 'womenswear'],
    strong: ['jacket', 'jackets', 'coat', 'parka', 'puffer', 'hoodie', 'sweatshirt', 'sweater', 'jumper', 'cardigan', 'shirt', 't-shirt', 'tee', 'blouse', 'pants', 'trousers', 'jeans', 'denim', 'chinos', 'shorts', 'skirt', 'dress', 'sneakers', 'trainers', 'shoes', 'boots', 'loafers', 'sandals', 'heels', 'running shoes', 'trail runners', 'socks', 'beanie', 'scarf', 'gloves', 'mittens', 'leggings', 'joggers', 'sweatpants', 'blazer', 'suit', 'vest', 'gilet', 'fleece', 'raincoat', 'anorak', 'windbreaker', 'bra', 'underwear', 'boxers', 'swimsuit', 'bikini', 'trunks', 'overalls', 'jumpsuit', 'romper', 'polo', 'oxford shirt', 'flannel', 'cap', 'bucket hat', 'belt', 'wallet', 'sunglasses', 'watch', 'tote bag', 'crossbody', 'handbag', 'backpack purse', 'earrings', 'necklace', 'bracelet', 'ring'],
    keywords: ['wear', 'outfit', 'apparel', 'fit', 'size', 'sizing', 'xs', 'xl', 'xxl', 'mens', "men's", 'womens', "women's", 'unisex', 'cotton', 'wool', 'merino', 'cashmere', 'linen shirt', 'knit', 'knitwear', 'sleeve', 'long sleeve', 'short sleeve', 'crewneck', 'crew neck', 'v-neck', 'turtleneck', 'slim fit', 'relaxed fit', 'regular fit', 'high-rise', 'mid-rise', 'straight leg', 'wide leg', 'bootcut', 'waterproof jacket', 'gore-tex', 'down jacket', 'insulated jacket', 'nike', 'adidas', 'new balance', 'salomon', 'hoka', 'brooks', 'birkenstock', 'uniqlo', 'zara', 'levi*', 'carhartt', 'patagonia', 'arcteryx', "arc'teryx", 'lululemon', 'hat', 'jewelry', 'jewellery'],
  },
  {
    key: 'tech',
    name: 'Technology',
    description: 'Headphones, computers, phones, cameras, audio, smart home and gadgets.',
    color: '#5B7C8F',
    aliases: ['tech', 'technology', 'electronics', 'gadgets', 'gear', 'computers', 'audio', 'devices', 'gaming', 'pc', 'setup', 'desk setup'],
    strong: ['headphones', 'earbuds', 'earphones', 'laptop', 'macbook', 'notebook computer', 'desktop computer', 'monitor', 'keyboard', 'mechanical keyboard', 'mouse', 'trackpad', 'smartphone', 'iphone', 'android phone', 'tablet', 'ipad', 'smartwatch', 'apple watch', 'camera', 'mirrorless', 'dslr', 'lens', 'gopro', 'drone', 'speaker', 'bluetooth speaker', 'soundbar', 'turntable', 'amplifier', 'router', 'wifi', 'mesh wifi', 'nas', 'ssd', 'hard drive', 'graphics card', 'gpu', 'cpu', 'processor', 'motherboard', 'ram', 'power bank', 'charger', 'usb-c', 'usb hub', 'docking station', 'webcam', 'microphone', 'e-reader', 'kindle', 'console', 'playstation', 'xbox', 'nintendo', 'switch', 'steam deck', 'gaming pc', 'vr headset', 'projector', 'smart tv', 'oled', 'smart plug', 'smart bulb', 'thermostat', 'robot vacuum', 'gaming chair', 'gaming mouse', 'controller', 'gamepad'],
    keywords: ['wireless', 'bluetooth', 'usb', 'hdmi', 'display', 'screen', 'inch', '4k', 'hz', 'refresh rate', 'battery life', 'mah', 'watt', 'noise cancelling', 'noise-cancelling', 'anc', 'audio', 'hi-fi', 'hifi', 'stereo', 'gadget*', 'device', 'electronic*', 'tech', 'smart', 'app', 'sensor', 'cable', 'adapter', 'dongle', 'firmware', 'ssd', 'tb', 'gb', 'ram', 'apple', 'samsung', 'sony', 'bose', 'logitech', 'anker', 'dell', 'lenovo', 'asus', 'razer', 'corsair', 'nvidia', 'amd', 'intel', 'garmin', 'dji', 'canon', 'nikon', 'fujifilm', 'raspberry pi', 'arduino', 'microcontroller', 'gaming', 'pc'],
  },
  {
    key: 'kitchen',
    name: 'Kitchen',
    description: 'Cookware, knives, small appliances, coffee gear and tools for cooking at home.',
    color: '#A66A4C',
    aliases: ['kitchen', 'cooking', 'cookware', 'cook', 'baking', 'coffee', 'dining', 'kitchenware', 'food', 'chef'],
    strong: ['skillet', 'frying pan', 'fry pan', 'saucepan', 'stockpot', 'dutch oven', 'braiser', 'wok', 'cast iron', 'carbon steel pan', 'chef knife', "chef's knife", 'santoku', 'paring knife', 'bread knife', 'knife set', 'cutting board', 'chopping board', 'stand mixer', 'kitchenaid', 'blender', 'food processor', 'air fryer', 'toaster', 'toaster oven', 'espresso machine', 'coffee maker', 'coffee grinder', 'burr grinder', 'pour over', 'pour-over', 'french press', 'aeropress', 'moka pot', 'kettle', 'gooseneck kettle', 'rice cooker', 'slow cooker', 'pressure cooker', 'instant pot', 'sous vide', 'immersion circulator', 'mandoline', 'grater', 'microplane', 'peeler', 'whisk', 'spatula', 'ladle', 'tongs', 'colander', 'mixing bowl', 'baking sheet', 'sheet pan', 'loaf pan', 'cake pan', 'muffin tin', 'rolling pin', 'measuring cup*', 'measuring spoon*', 'dinnerware', 'plates', 'bowls', 'mug', 'mugs', 'glassware', 'wine glass*', 'cocktail shaker', 'bar cart', 'spice rack', 'salt cellar', 'pepper mill', 'dish rack', 'kitchen scale', 'food storage', 'meal prep', 'lunch box', 'bento', 'tea infuser', 'teapot', 'kettle', 'wine opener', 'corkscrew', 'pizza oven', 'pizza stone', 'griddle', 'grill pan', 'kitchen towel', 'apron', 'trivet', 'oven mitt*'],
    keywords: ['cook*', 'bak*', 'kitchen*', 'nonstick', 'non-stick', 'enameled', 'stainless', 'stainless steel', 'pan', 'pot', 'oven', 'stove*', 'roast*', 'sauté', 'saute', 'simmer', 'recipe', 'chef', 'cutlery', 'flatware', 'utensil*', 'appliance', 'countertop', 'dishwasher', 'coffee', 'espresso', 'tea', 'barista', 'le creuset', 'staub', 'lodge', 'all-clad', 'zwilling', 'wusthof', 'global', 'breville', 'vitamix', 'ninja', 'cuisinart', 'oxo', 'fellow', 'hario', 'chemex', 'baratza', 'smeg', 'de\'longhi', 'delonghi'],
  },
  {
    key: 'van',
    name: 'Van Build',
    description: 'Parts, power, water, insulation and accessories for a camper van or overland build.',
    color: '#7A7F5E',
    aliases: ['van', 'van build', 'vanlife', 'van life', 'camper van', 'campervan', 'conversion', 'van conversion', 'overland', 'overlanding', 'rv', 'sprinter', 'promaster', 'transit', 'bus build', 'skoolie'],
    strong: ['van', 'vanlife', 'van life', 'camper van', 'campervan', 'van conversion', 'van build', 'sprinter', 'promaster', 'ford transit', 'transit van', 'overland', 'overlanding', 'roof fan', 'maxxair', 'maxxfan', 'fantastic fan', 'roof vent', 'diesel heater', 'webasto', 'espar', 'house battery', 'lithium battery', 'lifepo4', 'battle born', 'inverter', 'inverter charger', 'victron', 'renogy', 'dc-dc charger', 'solar panel', 'solar charge controller', 'mppt', 'shore power', 'bus bar', 'busbar', 'fuse block', 'water tank', 'fresh water tank', 'grey water tank', 'water pump', 'shurflo', 'sink faucet 12v', '12v', '12 volt', 'composting toilet', 'cassette toilet', 'swivel seat', 'seat swivel', 'awning', 'ladder rack', 'roof rack', 'bull bar', 'recovery board*', 'maxtrax', 'skylight', 'bunk window', 'van window', 'sliding door', 'insulation', 'havelock wool', 'thinsulate', 'reflectix', 'sound deadening', 'kilmat', 'subfloor', 'cabinet latch*', 'push latch*', 'l-track', 'l track', 'unistrut', 'rivnut*', 'plusnut*', 'camper', 'rv'],
    keywords: ['conversion', 'build', 'off-grid', 'offgrid', 'off grid', 'overlander', 'campervan', 'motorhome', 'chassis', 'cargo van', 'wiring', 'wire gauge', 'awg', 'ah', 'amp hour', 'volt', 'dc', 'charger', 'battery monitor', 'shunt', 'isolator', 'alternator', 'propane locker', 'ventilation', 'fan', 'vent', 'heater', 'tank', 'pump', 'faucet', 'shower', 'toilet', 'bed platform', 'slat*', 'plywood', 'ceiling panel*', 'wall panel*', 'trim', 'swivel', 'rack', 'mount', 'bracket', 'grille', 'wheel', 'tire', 'tyre', 'suspension', 'lift kit', 'suspension seat', 'nomad'],
  },
  {
    key: 'care',
    name: 'Personal Care',
    description: 'Skincare, haircare, grooming, fragrance, wellness and bathroom essentials.',
    color: '#C08A8A',
    aliases: ['personal care', 'skincare', 'skin care', 'beauty', 'grooming', 'self care', 'self-care', 'wellness', 'bath', 'body', 'cosmetics', 'makeup', 'hair'],
    strong: ['moisturizer', 'moisturiser', 'serum', 'cleanser', 'face wash', 'toner', 'sunscreen', 'spf', 'retinol', 'hyaluronic', 'niacinamide', 'vitamin c serum', 'eye cream', 'face mask', 'sheet mask', 'lip balm', 'lotion', 'body wash', 'shampoo', 'conditioner', 'hair oil', 'hair mask', 'beard oil', 'beard trimmer', 'razor', 'safety razor', 'shaving cream', 'shave', 'electric shaver', 'deodorant', 'antiperspirant', 'perfume', 'cologne', 'fragrance', 'eau de parfum', 'eau de toilette', 'toothbrush', 'electric toothbrush', 'toothpaste', 'floss', 'mouthwash', 'nail clipper*', 'tweezers', 'hair dryer', 'blow dryer', 'straightener', 'curling iron', 'hair trimmer', 'clippers', 'makeup', 'foundation', 'mascara', 'lipstick', 'blush', 'concealer', 'bronzer', 'brow', 'skincare', 'skin care', 'exfoliant', 'exfoliator', 'scrub', 'bath bomb', 'bath salt*', 'hand cream', 'hand soap', 'body oil', 'massage gun', 'gua sha', 'jade roller', 'pimple patch*', 'acne'],
    keywords: ['skin', 'face', 'facial', 'hair', 'beard', 'grooming', 'beauty', 'cosmetic*', 'fragrance', 'scent', 'spa', 'bath', 'body', 'hydrating', 'hydration', 'anti-aging', 'anti aging', 'wrinkle', 'pore*', 'oily skin', 'dry skin', 'sensitive skin', 'dermatolog*', 'cerave', 'la roche', 'the ordinary', 'cetaphil', 'neutrogena', 'aesop', 'kiehl*', 'clinique', 'glossier', 'olaplex', 'oral-b', 'philips sonicare', 'braun', 'harry\'s', 'gillette', 'dove', 'nivea', 'lush', 'byredo', 'le labo', 'jo malone', 'dior', 'chanel'],
  },
  {
    key: 'books',
    name: 'Books & Media',
    description: 'Books, vinyl, magazines, games and films worth remembering.',
    color: '#8A7B66',
    aliases: ['books', 'book', 'reading', 'library', 'media', 'to read', 'reading list', 'vinyl', 'records', 'music', 'movies', 'films', 'games', 'board games'],
    strong: ['book', 'books', 'novel', 'paperback', 'hardcover', 'hardback', 'audiobook', 'e-book', 'ebook', 'cookbook', 'memoir', 'biography', 'anthology', 'graphic novel', 'manga', 'comic', 'vinyl', 'vinyl record', 'lp', 'record', 'album', 'cd', 'cassette', 'blu-ray', 'bluray', 'dvd', 'box set', 'boxset', 'board game', 'card game', 'puzzle', 'jigsaw', 'magazine', 'zine', 'journal', 'notebook', 'sketchbook', 'planner', 'field notes', 'moleskine', 'leuchtturm', 'stationery', 'fountain pen', 'pen'],
    keywords: ['author', 'edition', 'isbn', 'pages', 'chapter*', 'read', 'reading', 'publisher', 'penguin', 'fiction', 'nonfiction', 'non-fiction', 'poetry', 'essays', 'literature', 'bestseller', 'kindle edition', 'press', 'illustrated', 'volume', 'series', 'soundtrack', 'ost', 'reissue', 'remaster*', 'pressing', '180g', 'players', 'expansion', 'tabletop', 'rpg', 'dice'],
  },
  {
    key: 'gifts',
    name: 'Gifts',
    description: 'Ideas for other people, and things to remember for birthdays and holidays.',
    color: '#B57B8F',
    aliases: ['gifts', 'gift', 'gift ideas', 'presents', 'present', 'for others', 'birthday', 'christmas', 'holiday gifts', 'wishlist for others'],
    strong: ['gift', 'gifts', 'gift set', 'gift box', 'gift basket', 'gift card', 'gift for', 'present for', 'stocking stuffer*', 'secret santa', 'anniversary gift', 'wedding gift', 'birthday gift', 'gift idea*', 'gift guide'],
    keywords: ['for him', 'for her', 'for mom', 'for dad', 'for kids', 'for couples', 'for the', 'personalized', 'personalised', 'engraved', 'custom', 'monogram*', 'novelty', 'keepsake', 'hamper', 'greeting card', 'wrapping', 'ribbon', 'holiday'],
  },
  {
    key: 'travel',
    name: 'Travel',
    description: 'Luggage, packing gear, travel accessories, hotels and places to go.',
    color: '#5E8A8F',
    aliases: ['travel', 'trip', 'trips', 'vacation', 'holiday', 'luggage', 'packing', 'destinations', 'places', 'places to go', 'airbnb', 'hotels', 'flights'],
    strong: ['suitcase', 'luggage', 'carry-on', 'carry on', 'checked bag', 'packing cube*', 'travel backpack', 'travel bag', 'duffel', 'duffle', 'weekender', 'passport holder', 'passport cover', 'travel pillow', 'neck pillow', 'travel adapter', 'universal adapter', 'toiletry bag', 'dopp kit', 'luggage tag', 'luggage scale', 'compression bag*', 'airtag', 'eye mask', 'sleep mask', 'hotel', 'hostel', 'resort', 'airbnb', 'flight', 'airline', 'itinerary', 'travel guide', 'guidebook', 'lonely planet', 'sim card', 'esim', 'rimowa', 'away', 'monos', 'samsonite', 'tumi', 'osprey farpoint', 'peak design travel'],
    keywords: ['travel*', 'trip', 'vacation', 'holiday', 'getaway', 'destination', 'abroad', 'international', 'tsa', 'lightweight', 'packable', 'foldable', 'wanderlust', 'road trip', 'city break', 'beach', 'island', 'tourist', 'tour', 'cruise', 'train', 'rail', 'jet lag', 'layover', 'overnight'],
  },
  {
    key: 'tools',
    name: 'Tools',
    description: 'Hand tools, power tools, workshop equipment and hardware.',
    color: '#6E7B86',
    aliases: ['tools', 'tool', 'workshop', 'garage', 'diy', 'hardware', 'woodworking', 'shop', 'maker', 'repair'],
    strong: ['drill', 'cordless drill', 'impact driver', 'circular saw', 'miter saw', 'mitre saw', 'table saw', 'jigsaw', 'jig saw', 'reciprocating saw', 'track saw', 'band saw', 'bandsaw', 'router', 'wood router', 'orbital sander', 'belt sander', 'planer', 'jointer', 'lathe', 'chisel', 'chisel set', 'hand plane', 'block plane', 'hammer', 'mallet', 'screwdriver', 'screwdriver set', 'wrench', 'wrench set', 'socket set', 'ratchet', 'torque wrench', 'pliers', 'needle nose', 'wire cutter*', 'wire stripper*', 'crimper', 'crimping tool', 'multimeter', 'soldering iron', 'heat gun', 'level', 'spirit level', 'laser level', 'tape measure', 'measuring tape', 'square', 'speed square', 'combination square', 'clamp', 'clamps', 'bar clamp', 'vise', 'vice', 'workbench', 'sawhorse', 'tool chest', 'tool box', 'toolbox', 'tool bag', 'tool belt', 'shop vac', 'dust collector', 'angle grinder', 'oscillating tool', 'multi tool', 'nail gun', 'brad nailer', 'staple gun', 'rivet gun', 'pocket hole jig', 'kreg', 'dewalt', 'milwaukee', 'makita', 'bosch', 'ryobi', 'festool', 'hilti', 'knipex', 'wera', 'wiha', 'klein tools', 'stanley', 'irwin', 'estwing'],
    keywords: ['tool*', 'cordless', 'brushless', '18v', '20v', 'battery platform', 'bit set', 'drill bit*', 'saw blade*', 'sandpaper', 'abrasive', 'workshop', 'garage', 'diy', 'woodworking', 'carpentry', 'hardware', 'fastener*', 'screws', 'bolts', 'anchors', 'lumber', 'metalworking', 'welding', 'welder', 'shop', 'jig', 'fence', 'dust', 'safety glasses', 'work gloves', 'ear protection', 'respirator'],
  },
];

export const INBOX_COLLECTION = {
  key: INBOX_KEY,
  name: 'Inbox',
  description: 'Things Keepsake could not place confidently. Sort them when you have a moment.',
  color: '#9A9A94',
  aliases: ['inbox', 'unsorted', 'uncategorized', 'uncategorised', 'to sort', 'misc', 'miscellaneous', 'other'],
  strong: [],
  keywords: [],
};

// Words that are common in product listings but say nothing about category.
export const STOPWORDS = new Set(('a an the and or of for to in on with by from at as is are be this that these those it its new sale off free shipping best top ' +
  'set pack pcs piece pieces count ct oz lb ml l cm mm inch inches x size color colour black white grey gray blue red green brown beige natural ' +
  'premium quality original official authentic classic modern style design designer collection edition limited exclusive luxury cheap deal ' +
  'buy shop online store now today only save price reviews review rating stars item product products brand ' +
  'small medium large extra xl xs s m l xxl one two three 2 3 4 5 6 10 12 20 24 50 100 amazon com co uk us').split(/\s+/));

export function taxonomyByKey(key) {
  if (key === INBOX_KEY) return INBOX_COLLECTION;
  return DEFAULT_TAXONOMY.find((t) => t.key === key) || null;
}
