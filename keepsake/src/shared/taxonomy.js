// Default collections. These are intelligent defaults, not rigid requirements:
// the categorizer matches against whatever collections the user actually has
// and only proposes one of these when nothing similar exists.
//
// `keywords` are matched as whole words/phrases in product text. A trailing
// `*` allows a prefix match (e.g. "lamp*" matches lamp, lamps, lampshade).
// `strong` keywords are near-unambiguous and lift confidence on their own.
//
// There is no "Inbox" taxonomy entry: items Keepsake can't confidently place
// are simply left uncategorized (collectionId: null) and surface in Review.

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
    strong: ['lamp', 'lamps', 'table lamp', 'floor lamp', 'bedside lamp', 'desk lamp', 'pendant light', 'chandelier', 'sconce', 'rug', 'rugs', 'area rug', 'mirror', 'wall art', 'art print', 'framed print', 'throw pillow', 'cushion cover', 'armchair', 'sofa', 'couch', 'loveseat', 'sectional', 'coffee table', 'side table', 'nightstand', 'bookshelf', 'bookcase', 'sideboard', 'credenza', 'dresser', 'headboard', 'bed frame', 'ottoman', 'vase', 'candle holder', 'planter', 'curtain*', 'duvet cover', 'bedding', 'wallpaper', 'lampshade', 'ceiling light', 'wall sconce', 'lounge chair', 'dining chair', 'dining table', 'bar stool', 'counter stool', 'console table', 'sheets', 'sheet set', 'bed sheets', 'fitted sheet', 'flat sheet', 'pillowcase', 'pillow case', 'duvet', 'duvet insert', 'comforter', 'bath towel', 'towel set', 'hand towel', 'bath mat', 'shower curtain', 'scented candle', 'soy candle', 'pillar candle', 'taper candle', 'candle set', 'home decor', 'homewares'],
    keywords: ['lamp*', 'light*', 'lighting', 'chair', 'stool', 'table', 'shelf', 'shelving', 'cabinet', 'bench', 'throw', 'blanket', 'pillow', 'cushion', 'decor*', 'decorative', 'ceramic', 'vase', 'candle', 'frame', 'poster', 'print', 'canvas', 'tapestry', 'clock', 'plant', 'planter', 'pot', 'linen', 'velvet', 'boucle', 'rattan', 'oak', 'walnut', 'teak', 'mid-century', 'midcentury', 'scandinavian', 'bohemian', 'boho', 'interior', 'furniture', 'sofa', 'mattress', 'sheet set', 'quilt', 'comforter', 'doormat', 'basket', 'tray', 'bookend*', 'sculpture', 'figurine', 'wall hook*', 'coat rack', 'dimmer', 'bulb', 'murano', 'glass shade', 'towel', 'bedroom', 'living room'],
  },
  {
    key: 'clothing',
    name: 'Clothing',
    description: 'Shoes, jackets, tops, pants, dresses, accessories and everything you wear.',
    color: '#8B6F8F',
    aliases: ['clothes', 'clothing', 'apparel', 'fashion', 'wardrobe', 'outfits', 'style', 'shoes', 'footwear', 'accessories', 'wear', 'menswear', 'womenswear'],
    strong: ['jacket', 'jackets', 'coat', 'parka', 'puffer', 'hoodie', 'sweatshirt', 'sweater', 'jumper', 'cardigan', 'shirt', 't-shirt', 'tee', 'blouse', 'pants', 'trousers', 'jeans', 'denim', 'chinos', 'shorts', 'skirt', 'dress', 'sneakers', 'trainers', 'shoes', 'boots', 'loafers', 'sandals', 'heels', 'running shoes', 'trail runners', 'socks', 'beanie', 'scarf', 'gloves', 'mittens', 'leggings', 'joggers', 'sweatpants', 'blazer', 'suit', 'vest', 'gilet', 'fleece', 'raincoat', 'anorak', 'windbreaker', 'bra', 'underwear', 'boxers', 'swimsuit', 'bikini', 'trunks', 'overalls', 'jumpsuit', 'romper', 'polo', 'oxford shirt', 'flannel', 'cap', 'bucket hat', 'belt', 'wallet', 'sunglasses', 'tote bag', 'crossbody', 'handbag', 'backpack purse', 'full print', 'all-over print', 'all over print', 'tops', 'bottoms', 'outerwear', 'footwear', 'swimwear', 'knitwear', 'boxer brief', 'briefs', 'tank top', 'crewneck', 'pullover', 'quarter zip', 'half zip', 'henley', 'hats'],
    keywords: ['wear', 'outfit', 'apparel', 'fit', 'size', 'sizing', 'xs', 'xl', 'xxl', 'mens', "men's", 'womens', "women's", 'unisex', 'cotton', 'wool', 'merino', 'cashmere', 'linen shirt', 'knit', 'knitwear', 'sleeve', 'long sleeve', 'short sleeve', 'crewneck', 'crew neck', 'v-neck', 'turtleneck', 'slim fit', 'relaxed fit', 'regular fit', 'high-rise', 'mid-rise', 'straight leg', 'wide leg', 'bootcut', 'waterproof jacket', 'gore-tex', 'down jacket', 'insulated jacket', 'nike', 'adidas', 'new balance', 'salomon', 'hoka', 'brooks', 'birkenstock', 'uniqlo', 'zara', 'levi*', 'carhartt', 'patagonia', 'arcteryx', "arc'teryx", 'lululemon', 'hat'],
  },
  {
    key: 'tech',
    name: 'Technology',
    description: 'Headphones, computers, phones, cameras, audio, smart home and gadgets.',
    color: '#5B7C8F',
    aliases: ['tech', 'technology', 'electronics', 'gadgets', 'gear', 'computers', 'audio', 'devices', 'gaming', 'pc', 'setup', 'desk setup'],
    strong: ['headphones', 'earbuds', 'earphones', 'laptop', 'macbook', 'notebook computer', 'desktop computer', 'monitor', 'keyboard', 'mechanical keyboard', 'mouse', 'trackpad', 'smartphone', 'iphone', 'android phone', 'tablet', 'ipad', 'smartwatch', 'apple watch', 'camera', 'mirrorless', 'dslr', 'lens', 'gopro', 'drone', 'speaker', 'bluetooth speaker', 'soundbar', 'turntable', 'amplifier', 'router', 'wifi', 'mesh wifi', 'nas', 'ssd', 'hard drive', 'graphics card', 'gpu', 'cpu', 'processor', 'motherboard', 'ram', 'power bank', 'charger', 'usb-c', 'usb hub', 'docking station', 'webcam', 'microphone', 'e-reader', 'kindle', 'console', 'playstation', 'xbox', 'nintendo', 'switch', 'steam deck', 'gaming pc', 'vr headset', 'projector', 'smart tv', 'oled', 'smart plug', 'smart bulb', 'thermostat', 'robot vacuum', 'gaming chair', 'gaming mouse', 'controller', 'gamepad', 'aa battery', 'aaa battery', 'rechargeable battery', 'battery charger', 'charging cable', 'usb cable', 'lightning cable', 'phone case', 'screen protector', 'wireless charger'],
    keywords: ['wireless', 'bluetooth', 'usb', 'hdmi', 'display', 'screen', 'inch', '4k', 'hz', 'refresh rate', 'battery life', 'mah', 'watt', 'noise cancelling', 'noise-cancelling', 'anc', 'audio', 'hi-fi', 'hifi', 'stereo', 'gadget*', 'device', 'electronic*', 'tech', 'smart', 'app', 'sensor', 'cable', 'adapter', 'dongle', 'firmware', 'ssd', 'tb', 'gb', 'ram', 'apple', 'samsung', 'sony', 'bose', 'logitech', 'anker', 'dell', 'lenovo', 'asus', 'razer', 'corsair', 'nvidia', 'amd', 'intel', 'garmin', 'dji', 'canon', 'nikon', 'fujifilm', 'raspberry pi', 'arduino', 'microcontroller', 'gaming', 'pc', 'battery'],
  },
  {
    key: 'kitchen',
    name: 'Kitchen',
    description: 'Cookware, knives, small appliances, coffee gear and tools for cooking at home.',
    color: '#A66A4C',
    aliases: ['kitchen', 'cooking', 'cookware', 'cook', 'baking', 'coffee', 'dining', 'kitchenware', 'food', 'chef'],
    strong: ['skillet', 'frying pan', 'fry pan', 'saucepan', 'stockpot', 'dutch oven', 'braiser', 'wok', 'cast iron', 'carbon steel pan', 'chef knife', "chef's knife", 'santoku', 'paring knife', 'bread knife', 'knife set', 'cutting board', 'chopping board', 'stand mixer', 'kitchenaid', 'blender', 'food processor', 'air fryer', 'toaster', 'toaster oven', 'espresso machine', 'coffee maker', 'coffee grinder', 'burr grinder', 'pour over', 'pour-over', 'french press', 'aeropress', 'moka pot', 'kettle', 'gooseneck kettle', 'rice cooker', 'slow cooker', 'pressure cooker', 'instant pot', 'sous vide', 'immersion circulator', 'mandoline', 'grater', 'microplane', 'peeler', 'whisk', 'spatula', 'ladle', 'tongs', 'colander', 'mixing bowl', 'baking sheet', 'sheet pan', 'loaf pan', 'cake pan', 'muffin tin', 'rolling pin', 'measuring cup*', 'measuring spoon*', 'dinnerware', 'plates', 'bowls', 'mug', 'mugs', 'glassware', 'wine glass*', 'cocktail shaker', 'bar cart', 'spice rack', 'salt cellar', 'pepper mill', 'dish rack', 'kitchen scale', 'food storage', 'meal prep', 'lunch box', 'bento', 'tea infuser', 'teapot', 'kettle', 'wine opener', 'corkscrew', 'pizza oven', 'pizza stone', 'griddle', 'grill pan', 'kitchen towel', 'apron', 'trivet', 'oven mitt*', 'drinkware', 'tumbler', 'water bottle', 'travel mug', 'cookware', 'bakeware', 'serveware', 'ice maker'],
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
    strong: ['moisturizer', 'moisturiser', 'serum', 'cleanser', 'face wash', 'toner', 'sunscreen', 'spf', 'retinol', 'hyaluronic', 'niacinamide', 'vitamin c serum', 'eye cream', 'face mask', 'sheet mask', 'lip balm', 'lotion', 'body wash', 'shampoo', 'conditioner', 'hair oil', 'hair mask', 'beard oil', 'beard trimmer', 'razor', 'safety razor', 'shaving cream', 'shave', 'electric shaver', 'deodorant', 'antiperspirant', 'perfume', 'cologne', 'fragrance', 'eau de parfum', 'eau de toilette', 'toothbrush', 'electric toothbrush', 'toothpaste', 'floss', 'mouthwash', 'nail clipper*', 'tweezers', 'hair dryer', 'blow dryer', 'straightener', 'curling iron', 'hair trimmer', 'clippers', 'makeup', 'foundation', 'mascara', 'lipstick', 'blush', 'concealer', 'bronzer', 'brow', 'skincare', 'skin care', 'exfoliant', 'exfoliator', 'scrub', 'bath bomb', 'bath salt*', 'hand cream', 'hand soap', 'body oil', 'massage gun', 'gua sha', 'jade roller', 'pimple patch*', 'acne', 'haircare', 'hair care', 'body care', 'bodycare', 'bar soap', 'soap'],
    keywords: ['skin', 'face', 'facial', 'hair', 'beard', 'grooming', 'beauty', 'cosmetic*', 'fragrance', 'scent', 'spa', 'bath', 'body', 'hydrating', 'hydration', 'anti-aging', 'anti aging', 'wrinkle', 'pore*', 'oily skin', 'dry skin', 'sensitive skin', 'dermatolog*', 'cerave', 'la roche', 'the ordinary', 'cetaphil', 'neutrogena', 'aesop', 'kiehl*', 'clinique', 'glossier', 'olaplex', 'oral-b', 'philips sonicare', 'braun', 'harry\'s', 'gillette', 'dove', 'nivea', 'lush', 'byredo', 'le labo', 'jo malone', 'dior', 'chanel'],
  },
  {
    key: 'books',
    name: 'Books & Media',
    description: 'Books, vinyl, magazines, games and films worth remembering.',
    color: '#8A7B66',
    aliases: ['books', 'book', 'reading', 'library', 'media', 'to read', 'reading list', 'vinyl', 'records', 'music', 'movies', 'films', 'games', 'board games'],
    strong: ['book', 'books', 'novel', 'paperback', 'hardcover', 'hardback', 'audiobook', 'e-book', 'ebook', 'cookbook', 'memoir', 'biography', 'anthology', 'graphic novel', 'manga', 'comic', 'vinyl', 'vinyl record', 'lp', 'record', 'album', 'cd', 'cassette', 'blu-ray', 'bluray', 'dvd', 'box set', 'boxset', 'board game', 'card game', 'puzzle', 'jigsaw', 'magazine', 'zine'],
    keywords: ['author', 'edition', 'isbn', 'pages', 'chapter*', 'read', 'reading', 'publisher', 'penguin', 'fiction', 'nonfiction', 'non-fiction', 'poetry', 'essays', 'literature', 'bestseller', 'kindle edition', 'press', 'illustrated', 'volume', 'series', 'soundtrack', 'ost', 'reissue', 'remaster*', 'pressing', '180g', 'players', 'expansion', 'tabletop', 'rpg', 'dice'],
  },
  {
    key: 'gifts',
    name: 'Gifts',
    description: 'Ideas for other people, and things to remember for birthdays and holidays.',
    color: '#B57B8F',
    aliases: ['gifts', 'gift', 'gift ideas', 'presents', 'present', 'for others', 'birthday', 'christmas', 'holiday gifts', 'wishlist for others'],
    strong: ['gift', 'gifts', 'gift set', 'gift box', 'gift basket', 'gift card', 'gift for', 'present for', 'stocking stuffer*', 'secret santa', 'anniversary gift', 'wedding gift', 'birthday gift', 'gift idea*', 'gift guide'],
    keywords: ['for him', 'for her', 'for mom', 'for dad', 'for kids', 'for couples', 'for the', 'personalized', 'personalised', 'engraved', 'custom', 'monogram*', 'novelty', 'keepsake', 'hamper'],
  },
  {
    key: 'travel',
    name: 'Travel',
    description: 'Luggage, packing gear, travel accessories, hotels and places to go.',
    color: '#5E8A8F',
    aliases: ['travel', 'trip', 'trips', 'vacation', 'holiday', 'luggage', 'packing', 'destinations', 'places', 'places to go', 'airbnb', 'hotels', 'flights'],
    strong: ['suitcase', 'luggage', 'carry-on', 'carry on', 'checked bag', 'packing cube*', 'travel backpack', 'travel bag', 'duffel', 'duffle', 'weekender', 'passport holder', 'passport cover', 'travel pillow', 'neck pillow', 'travel adapter', 'universal adapter', 'toiletry bag', 'dopp kit', 'luggage tag', 'luggage scale', 'compression bag*', 'airtag', 'eye mask', 'sleep mask', 'hotel', 'hostel', 'resort', 'airbnb', 'flight', 'airline', 'itinerary', 'travel guide', 'guidebook', 'lonely planet', 'sim card', 'esim', 'rimowa', 'away', 'monos', 'samsonite', 'tumi', 'osprey farpoint', 'peak design travel', 'beach towel', 'travel towel'],
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
  {
    key: 'weddings',
    name: 'Weddings',
    description: 'Dresses, rings, invitations, registry finds and everything for the big day.',
    color: '#C9899A',
    aliases: ['wedding', 'weddings', 'bride', 'bridal', 'groom', 'engagement', 'bachelorette', 'bachelor party', 'registry', 'save the date'],
    strong: ['wedding dress', 'bridal gown', 'bridesmaid dress', 'groomsmen gift*', 'wedding invitation*', 'save the date', 'wedding band', 'engagement ring', 'wedding ring', 'bridal shower', 'bachelorette party', 'bachelor party', 'wedding favor*', 'wedding centerpiece*', 'bridal veil', 'tuxedo rental', 'wedding registry', 'cake topper', 'unity candle', 'ring bearer pillow', 'flower girl dress', 'bridal robe', 'wedding guest book', 'seating chart', 'wedding arch', 'ceremony backdrop', 'bridal party gift*'],
    keywords: ['bride', 'bridal', 'groom', 'groomsmen', 'bridesmaid*', 'fiancé', 'fiancée', 'engaged', 'engagement', 'proposal', 'venue', 'officiant', 'ceremony', 'reception', 'vows', 'wedding planner', 'tux', 'tuxedo', 'boutonniere', 'bouquet', 'floral arrangement', 'registry', 'honeymoon', 'elopement', 'destination wedding', 'wedding shoes', 'garter'],
  },
  {
    key: 'baby',
    name: 'Baby & Kids',
    description: 'Nursery decor, baby gear, toys and clothing for little ones.',
    color: '#9FB3A8',
    aliases: ['baby', 'babies', 'infant', 'newborn', 'nursery', 'toddler', 'kids', 'children', 'parenting', 'kid stuff'],
    strong: ['crib', 'bassinet', 'changing table', 'diaper bag', 'stroller', 'car seat', 'baby carrier', 'baby monitor', 'high chair', 'booster seat', 'baby bottle*', 'breast pump', 'baby swing', 'bouncer seat', 'play mat', 'play yard', 'pack n play', 'pack and play', 'baby gate', 'onesie*', 'swaddle', 'burp cloth*', 'pacifier', 'teether', 'baby food maker', 'nursing pillow', 'diaper pail', 'baby bathtub', 'crib mattress', 'baby mobile', 'nursery glider', 'kids table and chairs', 'toy chest', 'baby shower gift'],
    keywords: ['baby', 'babies', 'infant', 'newborn', 'nursery', 'toddler', 'kids*', 'children', 'diaper*', 'onesie*', 'stroller', 'crib', 'lullaby', 'montessori', 'preschool', 'kids room', 'toy*', 'lego', 'building blocks', 'plush', 'stuffed animal', 'baby shower', 'gender reveal', 'booster', 'sippy cup', 'baby proofing', 'night light', 'kids backpack', 'school supplies', 'lunchbox'],
  },
  {
    key: 'pets',
    name: 'Pets',
    description: 'Toys, beds, food and gear for dogs, cats and other pets.',
    color: '#BE9C6B',
    aliases: ['pets', 'pet', 'dog', 'dogs', 'cat', 'cats', 'puppy', 'kitten', 'pet supplies', 'pet gear'],
    strong: ['dog bed', 'cat bed', 'dog leash', 'dog collar', 'cat litter box', 'litter box', 'cat tree', 'cat scratcher', 'scratching post', 'dog crate', 'pet carrier', 'dog harness', 'dog food', 'cat food', 'pet food', 'dog toy*', 'cat toy*', 'chew toy*', 'dog bowl', 'cat bowl', 'feeding station', 'pet gate', 'dog house', 'fish tank', 'terrarium', 'bird cage', 'hamster cage', 'flea collar', 'dog treats', 'cat treats', 'pet grooming kit', 'dog shampoo', 'pet stroller', 'automatic feeder', 'pet fountain', 'dog raincoat', 'dog sweater', 'cat tower'],
    keywords: ['dog', 'dogs', 'cat', 'cats', 'puppy', 'puppies', 'kitten*', 'pet*', 'canine', 'feline', 'leash', 'collar', 'litter', 'aquarium', 'terrarium', 'reptile', 'hamster', 'guinea pig', 'rabbit', 'vet', 'veterinary', 'kennel', 'chewy', 'petco', 'petsmart', 'kong', 'grooming'],
  },
  {
    key: 'fitness',
    name: 'Fitness & Wellness',
    description: 'Workout gear, yoga, supplements and equipment for staying active.',
    color: '#6E9E8C',
    aliases: ['fitness', 'workout', 'exercise', 'gym', 'wellness', 'yoga', 'training', 'athletic'],
    strong: ['yoga mat', 'dumbbell*', 'kettlebell*', 'resistance band*', 'treadmill', 'exercise bike', 'stationary bike', 'peloton', 'rowing machine', 'weight bench', 'squat rack', 'power rack', 'jump rope', 'foam roller', 'pull-up bar', 'ab roller', 'workout gloves', 'gym bag', 'protein powder', 'pre-workout', 'creatine', 'whey protein', 'fitness tracker', 'heart rate monitor', 'gym mat', 'weighted vest', 'medicine ball', 'exercise ball', 'yoga block*', 'yoga strap', 'massage gun', 'compression sleeve*', 'protein shaker', 'elliptical machine', 'barbell', 'lifting belt', 'home gym', 'adjustable bench', 'gym bench'],
    keywords: ['fitness', 'workout', 'exercise', 'gym', 'training', 'cardio', 'strength', 'hiit', 'crossfit', 'pilates', 'yoga', 'meditation', 'stretching', 'mobility', 'recovery', 'muscle', 'reps', 'sets', 'activewear', 'running', 'marathon', 'nutrition', 'supplement*', 'bcaa', 'electrolyte*', 'wellness', 'mindfulness', 'lululemon', 'gymshark', 'nike training'],
  },
  {
    key: 'garden',
    name: 'Garden & Outdoor Living',
    description: 'Plants, patio furniture, grills and gear for the yard and garden.',
    color: '#8DA06E',
    aliases: ['garden', 'gardening', 'backyard', 'patio', 'outdoor living', 'yard', 'landscaping', 'plants'],
    strong: ['patio furniture', 'outdoor sofa', 'patio umbrella', 'fire pit table', 'garden hose', 'lawn mower', 'leaf blower', 'hedge trimmer', 'pruning shears', 'garden gloves', 'raised garden bed', 'planter box', 'watering can', 'gas grill', 'charcoal grill', 'smoker grill', 'outdoor rug', 'hammock stand', 'porch swing', 'outdoor string lights', 'garden trellis', 'greenhouse kit', 'compost bin', 'sprinkler system', 'garden gnome', 'bird feeder', 'wind chime', 'outdoor cushion*', 'deck chair', 'adirondack chair', 'garden shed', 'wheelbarrow', 'plant stand', 'seed starter kit', 'potting soil', 'garden tool set', 'weed killer', 'outdoor heater', 'patio heater'],
    keywords: ['garden*', 'gardening', 'backyard', 'patio', 'yard', 'lawn', 'landscap*', 'flower bed', 'perennial*', 'annual*', 'shrub*', 'mulch', 'topsoil', 'greenhouse', 'grill*', 'bbq', 'barbecue', 'outdoor furniture', 'deck', 'porch', 'pergola', 'gazebo', 'fence', 'irrigation', 'terracotta', 'succulent*', 'hose', 'shovel', 'rake', 'trowel', 'fertilizer'],
  },
  {
    key: 'crafts',
    name: 'Art & Crafts',
    description: 'Paint, yarn, fabric and supplies for making things by hand.',
    color: '#C68B5B',
    aliases: ['crafts', 'craft supplies', 'diy crafts', 'art supplies', 'crafting', 'handmade', 'hobby', 'sewing', 'knitting'],
    strong: ['sewing machine', 'embroidery hoop', 'embroidery floss', 'cross stitch', 'knitting needle*', 'crochet hook*', 'yarn skein', 'fabric bolt', 'quilting fabric', 'cricut', 'cricut maker', 'vinyl cutter', 'heat press', 'washi tape', 'scrapbook*', 'acrylic paint', 'watercolor paint', 'oil paint', 'paint brush set', 'canvas panel', 'calligraphy pen', 'glue gun', 'hot glue stick*', 'craft scissors', 'jewelry making kit', 'polymer clay', 'air dry clay', 'pottery wheel', 'craft kiln', 'resin kit', 'epoxy resin', 'stamping ink', 'rubber stamp*', 'stencil*', 'origami paper', 'macrame cord', 'felting wool', 'sewing pattern', 'yarn bundle', 'yarn kit', 'skein', 'knitting', 'crochet', 'crochet kit', 'knitting kit', 'embroidery kit'],
    keywords: ['craft*', 'diy', 'handmade', 'sewing', 'knit*', 'crochet', 'quilt*', 'embroidery', 'fabric', 'yarn', 'thread', 'stitch*', 'paint*', 'canvas', 'sketch*', 'drawing', 'illustration', 'watercolor', 'acrylic', 'scrapbooking', 'bead*', 'resin', 'pottery', 'ceramics class', 'hobby lobby', 'michaels', 'joann'],
  },
  {
    key: 'office',
    name: 'Office & Stationery',
    description: 'Desk setups, planners, notebooks and supplies for work and study.',
    color: '#7F8FA0',
    aliases: ['office', 'stationery', 'desk', 'desk setup', 'workspace', 'school supplies', 'planner', 'office supplies'],
    strong: ['desk organizer', 'standing desk', 'desk chair', 'office chair', 'monitor arm', 'monitor stand', 'desk mat', 'mouse pad', 'cable organizer', 'daily planner', 'bullet journal', 'fountain pen', 'gel pen*', 'highlighter set', 'sticky note*', 'index card*', 'file folder*', 'label maker', 'paper shredder', 'pencil case', 'binder clip*', 'three ring binder', 'letter tray', 'whiteboard', 'corkboard', 'pin board', 'sticker sheet*', 'notebook set', 'composition notebook', 'legal pad', 'moleskine', 'leuchtturm', 'field notes', 'desk frame', 'desk converter'],
    keywords: ['office', 'stationery', 'desk', 'workspace', 'planner', 'notebook', 'journal', 'pen', 'pencil', 'notepad', 'organizer', 'folder*', 'binder', 'sticky note*', 'productivity', 'work from home', 'wfh', 'ergonomic', 'filing', 'school supplies', 'back to school', 'sketchbook', 'staples', 'muji'],
  },
  {
    key: 'auto',
    name: 'Automotive',
    description: 'Car care, parts, accessories and gear for your vehicle.',
    color: '#516472',
    aliases: ['car', 'cars', 'auto', 'automotive', 'vehicle', 'motorcycle', 'car accessories', 'car care'],
    strong: ['car cover', 'floor mat*', 'seat cover*', 'dash cam', 'car vacuum', 'jump starter', 'car battery', 'tire inflator', 'car wax', 'car detailing kit', 'microfiber towel*', 'bike rack car', 'trailer hitch', 'phone mount car', 'car charger', 'motor oil', 'windshield wiper*', 'brake pad*', 'spark plug*', 'car air filter', 'car alarm', 'remote start', 'license plate frame', 'steering wheel cover', 'tow strap', 'jumper cable*', 'tire pressure gauge', 'motorcycle helmet', 'motorcycle jacket', 'car wash kit', 'ceramic coating', 'exhaust system', 'performance chip'],
    keywords: ['car', 'cars', 'auto*', 'vehicle', 'sedan', 'suv', 'truck', 'motorcycle', 'engine', 'horsepower', 'tire*', 'tyre*', 'wheel*', 'rim*', 'detailing', 'garage', 'mechanic', 'dealership', 'mileage', 'mpg', 'ev', 'electric vehicle', 'tesla', 'ev charging cable', 'obd2', 'roof box'],
  },
  {
    key: 'jewelry',
    name: 'Jewelry & Watches',
    description: 'Rings, necklaces, watches and fine accessories.',
    color: '#B39A63',
    aliases: ['jewelry', 'jewellery', 'watches', 'watch', 'fine jewelry', 'accessories jewelry'],
    strong: ['necklace', 'pendant necklace', 'bracelet', 'tennis bracelet', 'earrings', 'stud earrings', 'hoop earrings', 'ring', 'wristwatch', 'smartwatch band', 'cufflink*', 'brooch', 'anklet', 'charm bracelet', 'diamond ring', 'gold necklace', 'silver necklace', 'pearl necklace', 'locket', 'signet ring', 'chain necklace', 'ear cuff', 'nose ring', 'body jewelry', 'watch band', 'watch strap'],
    keywords: ['jewelry', 'jewellery', 'gold', 'silver', 'platinum', 'sterling silver', '14k', '18k', 'karat', 'gemstone', 'diamond', 'sapphire', 'ruby', 'emerald', 'pearl', 'birthstone', 'mejuri', 'kendra scott', 'pandora', 'tiffany', 'cartier', 'rolex', 'omega watch', 'casio', 'citizen watch', 'fossil watch'],
  },
  {
    key: 'music',
    name: 'Music & Instruments',
    description: 'Instruments, gear and equipment for playing and recording music.',
    color: '#7C7398',
    aliases: ['music', 'musical instrument*', 'instrument', 'band', 'orchestra', 'music gear'],
    strong: ['electric guitar', 'acoustic guitar', 'bass guitar', 'guitar amp', 'guitar pedal', 'ukulele', 'digital piano', 'keyboard piano', 'drum set', 'drum kit', 'cymbal*', 'violin', 'cello', 'saxophone', 'trumpet', 'clarinet', 'flute', 'harmonica', 'guitar strings', 'guitar case', 'music stand', 'metronome', 'capo', 'guitar pick*', 'audio interface', 'studio monitor*', 'midi keyboard', 'mixing console', 'dj controller', 'record player', 'sheet music', 'tuning pedal'],
    keywords: ['music', 'musician', 'band practice', 'chord*', 'songwriting', 'recording studio', 'amp*', 'pedal board', 'fender', 'gibson', 'yamaha instrument', 'roland', 'shure', 'audio-technica', 'ableton', 'garageband', 'daw', 'karaoke'],
  },
  {
    key: 'party',
    name: 'Party & Events',
    description: 'Decorations, tableware and supplies for parties and celebrations.',
    color: '#C4785F',
    aliases: ['party', 'party supplies', 'celebration', 'event', 'birthday party', 'holiday decor', 'decorations'],
    strong: ['balloon*', 'confetti', 'party favor*', 'piñata', 'pinata', 'party hat*', 'streamers', 'birthday banner', 'cake stand', 'party tablecloth', 'disposable plates', 'party cups', 'birthday candle*', 'gift wrap', 'wrapping paper', 'gift bag*', 'christmas tree', 'christmas ornament*', 'holiday string lights', 'halloween costume', 'easter basket', 'advent calendar', 'stocking*', 'wreath', 'tinsel', 'photo booth prop*', 'party table runner', 'party centerpiece*'],
    keywords: ['party', 'celebration', 'birthday', 'holiday', 'christmas', 'halloween', 'easter', 'thanksgiving', 'new year*', 'decoration*', 'festive', 'invite*', 'invitation*', 'theme party', 'costume', 'trick or treat', 'santa', 'ornament*', 'garland', 'wrapping', 'ribbon', 'greeting card'],
  },
];

// Words that are common in product listings but say nothing about category.
export const STOPWORDS = new Set(('a an the and or of for to in on with by from at as is are be this that these those it its new sale off free shipping best top ' +
  'set pack pcs piece pieces count ct oz lb ml l cm mm inch inches x size color colour black white grey gray blue red green brown beige natural ' +
  'premium quality original official authentic classic modern style design designer collection edition limited exclusive luxury cheap deal ' +
  'buy shop online store now today only save price reviews review rating stars item product products brand ' +
  'small medium large extra xl xs s m l xxl one two three 2 3 4 5 6 10 12 20 24 50 100 amazon com co uk us').split(/\s+/));

export function taxonomyByKey(key) {
  return DEFAULT_TAXONOMY.find((t) => t.key === key) || null;
}
