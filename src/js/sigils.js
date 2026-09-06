// The sigil picker — a prose-first symbol palette for the composer. Ordered by real writing use:
// typography and scene breaks first (the daily drivers), ornaments and mood stamps next, then
// GM flavor, esoterica for lore headers, and marks. Entries are STRINGS, not single characters —
// quote pairs insert with the caret between them, dividers insert whole. Each group holds 3+
// pages (32 glyphs a page, ‹ n/m › to flip); search filters by name across everything; recents
// remember the last sixteen. Entry format: 'glyph|name|keywords'.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.sigils = (function () {
  const DATA = {
    type: [
      '—|em dash|dash break line pause', '–|en dash|dash range between', '―|horizontal bar|dash quote',
      '‒|figure dash|dash number', '⁓|swung dash|dash wave approx', '~|tilde|approx swing',
      '…|ellipsis|dots trailing pause', '‥|two-dot leader|dots', '·|interpunct|dot middot point separator',
      '•|bullet|dot point list', '‣|triangular bullet|point list', '⁃|hyphen bullet|point list',
      '◦|white bullet|point hollow', '▪|small square bullet|point list', '⁎|low asterisk|star footnote',
      '“”|curly double quotes|quote pair speech', '‘’|curly single quotes|quote pair apostrophe speech',
      '«»|guillemets|quote pair french', '‹›|single guillemets|quote pair',
      '„|low opening quote|german quote', '‟|reversed quotes|quote pair',
      '′|prime|feet minutes apostrophe', '″|double prime|inches seconds',
      '†|dagger|obelisk footnote death', '‡|double dagger|obelisk footnote', '⹋|triple dagger|footnote',
      '§|section|paragraph law', '¶|pilcrow|paragraph', '⁋|reversed pilcrow|paragraph',
      '№|numero|number', 'ª|ordinal feminine|a', 'º|ordinal masculine|o',
      '&|ampersand|and', '﹠|small ampersand|and', '⁂|asterism|stars break divider',
      '°|degree|angle temperature', '‰|per mille|percent thousand', '‱|per ten thousand|percent',
      '¤|currency mark|ornament coin', '¦|broken bar|pipe divider', '||vertical bar|pipe divider',
      '„|low quote|german', '〃|ditto|repeat', '∴|therefore|logic thus', '∵|because|logic since',
      '⟨⟩|angle brackets|pair math', '〈〉|cjk angle brackets|pair',
      '「」|corner brackets|pair cjk dialogue', '『』|white corner brackets|pair cjk',
      '【】|black brackets|pair cjk header', '〔〕|tortoise brackets|pair cjk',
      '（ ）|fullwidth parens|pair wide', '《》|double angle brackets|pair title',
      '¹|superscript one|power', '²|superscript two|square power', '³|superscript three|cube power',
      '⁰|superscript zero|power', 'ⁿ|superscript n|power', '⁺|superscript plus|math',
      '₀|subscript zero|below', '₁|subscript one|below', '½|half|fraction',
      '¼|quarter|fraction', '¾|three quarters|fraction', '⅓|third|fraction',
      '⅔|two thirds|fraction', '⅛|eighth|fraction', '⅜|three eighths|fraction',
      'á|a acute|accent name', 'é|e acute|accent name french', 'í|i acute|accent',
      'ó|o acute|accent', 'ú|u acute|accent', 'à|a grave|accent french',
      'è|e grave|accent', 'ì|i grave|accent', 'ò|o grave|accent',
      'ù|u grave|accent', 'â|a circumflex|accent french', 'ê|e circumflex|accent',
      'î|i circumflex|accent', 'ô|o circumflex|accent', 'û|u circumflex|accent',
      'ë|e diaeresis|accent', 'ï|i diaeresis|accent', 'ü|u diaeresis|accent german',
      'ñ|n tilde|accent spanish', 'ç|c cedilla|accent french', 'ß|sharp s|german esszett',
      'ø|o slash|accent nordic', 'å|a ring|accent nordic', 'æ|ae ligature|nordic old',
      'œ|oe ligature|french', 'Æ|capital ae|nordic', 'Œ|capital oe|french',
      'ł|l slash|polish', 'đ|d stroke|slavic', 'ő|o double acute|hungarian',
      'ű|u double acute|hungarian', 'ř|r caron|czech', 'š|s caron|czech slavic',
      'ž|z caron|czech slavic', 'ć|c acute|polish', 'ń|n acute|polish',
      'ṭ|t underdot|transliteration', 'ṣ|s underdot|transliteration', 'ā|a macron|long latin',
      'ī|i macron|long latin', 'ū|u macron|long latin', 'ē|e macron|long latin',
      'ō|o macron|long latin', 'Blank|zero-width|invisible spacer',
    ],
    breaks: [
      '⸻⸻⸻|heavy divider|scene break line', '— ✦ —|star divider|scene break star',
      '· · ⋯ · ·|quiet divider|soft scene break dots', '· · ⋯ ✦ ⋯ · ·|starlit divider|scene break star dots',
      '─────────|rule|line divider scene break', '─ ─ ─ ─ ─|dashed rule|line divider break',
      '❦ ❦ ❦|floral break|fleuron scene divider', '✦ ✦ ✦|triple star|scene break star',
      '≈≈≈|wave rule|water break divider', '·:·:·|dotted weave|pattern divider',
      '⌁ ⌁ ⌁|current divider|energy break', '⟡ ⟡ ⟡|star burst break|scene divider',
      '──────────────|long rule|line divider scene break', '──────────|rule|line divider',
      '───────|short rule|line divider', '━━━━━━━|heavy rule|thick line divider',
      '━━━━━━━━━━━|long heavy rule|thick divider', '┈┈┈┈┈┈┈|dashed light rule|dotted divider',
      '┅┅┅┅┅┅┅|dashed heavy rule|dotted divider', '╌╌╌╌╌╌╌|double dashed|divider',
      '═══════|double rule|thick divider', '⋯ ⋯ ⋯|dot rule|dotted divider',
      '· · — · ·|dot dash divider|quiet break', '— · —|dash dot dash|break small',
      '~ ~ ~|tilde break|soft wave divider', '~~~|tilde rule|wave divider',
      '≈ ≈ ≈|wave break|water divider', '- - -|hyphen break|plain divider',
      '***|asterisk break|scene divider', '* * *|spaced asterisks|scene divider',
      '# # #|hash break|scene divider', '= = =|equals rule|divider',
      '— ❖ —|diamond divider|scene break ornament', '— ◆ —|solid diamond divider|scene break',
      '— ✧ —|outlined star divider|scene break', '— ☾ —|moon divider|scene break night',
      '— ♆ —|neptune divider|sea break', '— ⚚ —|hermes divider|alchemy break',
      '· ✦ ·|star dot divider|small break', '· ❖ ·|diamond dot divider|small break',
      '· ☾ ·|moon dot divider|small break', '· • ·|bullet dot divider|small break',
      '✦ · ✦|star bracket divider|break', '❖ · ❖|diamond bracket divider|break',
      '☾ · ☽|moon pair divider|night break', '☽ ☾|moon pair|night mark',
      '·  ·  ·|wide dots|soft break', '·····|tight dots|dotted break',
      '⟡ · ⟡|burst dot divider|break', '⁂|asterism|stars triple break',
      '── ✦ ──|star line|scene break', '── ❦ ──|fleuron line|scene break',
      '── ☾ ──|moon line|scene break', '⋯ ✦ ⋯|star dots|scene break',
      '⋯ ❖ ⋯|diamond dots|scene break', '⋯ ☾ ⋯|moon dots|scene break',
      '—— ——|double em dashes|break pair', '— — —|em dash rule|break',
      '·|interpunct|dot', '•|bullet|dot', '—|em dash|dash', '…|ellipsis|dots',
      '⸺|two-em dash|long dash', '⸻|three-em dash|long dash', '‗|double low line|underline',
      '¯|macron|overline', '˙|dot above|accent', '¨|diaeresis|accent',
      'ʼ|modifier apostrophe|glottal', '‘|opening single|quote', '’|closing single|quote apostrophe',
      '“|opening double|quote', '”|closing double|quote', '«|opening guillemet|quote',
      '»|closing guillemet|quote', '‹|opening single guillemet|quote', '›|closing single guillemet|quote',
      '⌜|top left corner|bracket', '⌟|bottom right corner|bracket', '⌜⌟|corner pair|bracket pair',
      '︱|presentation dash|wide dash', '︵|presentation paren|wide', '﹏|wavy low line|squiggle underline',
      '▁▁▁▁|light shade rule|block divider', '▔▔▔▔|high shade rule|block divider',
      '░░░░░|light block rule|texture divider', '▒▒▒▒▒|medium block rule|texture divider',
      '▓▓▓▓▓|dark block rule|texture divider', '█ █ █|full block rule|heavy divider',
      '⋰ ⋱|rising dots|diagonal break', '⋮|vertical dots|column', '⋯|midline dots|dots',
    ],
    ornament: [
      '✦|four-pointed star|star cosmic sparkle', '✧|outlined star|star sparkle white',
      '★|black star|star', '☆|white star|star outline', '✶|six-pointed star|star',
      '✷|acute star|star', '✸|eight-pointed star|star compass', '✹|twelve-pointed star|star sun',
      '✺|sixteen-pointed star|star sun', '✻|teardrop star|snowflake ornament',
      '✼|open centre star|snowflake', '✽|heavy teardrop|snowflake ornament',
      '✾|petal star|flower ornament', '✿|white florette|flower',
      '❀|black florette|flower', '❁|eight-petal outline|flower',
      '❂|circled star|sun ornament', '❃|heavy teardrop ringed|flower',
      '❄|snowflake|winter star', '❅|tight snowflake|winter',
      '❆|heavy snowflake|winter', '❇|sparkle|spark star',
      '❈|heavy sparkle|spark snowflake', '❉|balloon sparkle|ornament',
      '❊|heavy teardrop spoke|ornament', '❋|heavy florette|snowflake star',
      '❖|diamond ornament|header marker', '◆|black diamond|marker',
      '◇|white diamond|marker outline', '◈|diamond in diamond|marker',
      '⬥|big black diamond|marker', '⬦|big white diamond|marker',
      '●|black circle|marker bullet', '○|white circle|marker outline',
      '◌|dotted circle|marker', '◍|circle filled dot|marker',
      '◎|bullseye circle|marker target', '◉|fisheye circle|marker',
      '◊|lozenge|diamond marker', '⬩|small diamond|marker',
      '■|black square|marker', '□|white square|marker outline',
      '▪|small square|marker bullet', '▫|small white square|marker',
      '◧|square half|marker', '◨|square half right|marker',
      '◩|square diagonal half|marker', '◪|square counter diagonal|marker',
      '▲|black triangle up|marker', '△|white triangle up|marker outline',
      '▶|black triangle right|marker play', '▷|white triangle right|marker',
      '◀|black triangle left|marker', '◁|white triangle left|marker',
      '▼|black triangle down|marker', '▽|white triangle down|marker',
      '(^)(^)|caret pair|decoration', '˄|modifier triangle up|caret',
      '˅|modifier triangle down|caret', '※|reference mark|note attention',
      '⁂|asterism|stars triple', '¤|currency mark|ornament',
      '☙|reversed floral heart|fleuron leaf', '❧|rotated floral heart|fleuron leaf',
      '❥|rotated heart|leaf', '❦|fleuron|floral heart leaf',
      '❣|heavy heart exclamation|love', '༓|mark ornament|loop',
      '⟡|star burst|sparkle', '⟢⟣|angled ornaments|pair decoration',
      '✵|turning star|pinwheel', '⌁|electric arrow|energy current',
      '⌇|wavy line|squiggle', '⌀|diameter sign|circle slash',
      '❴|left tortoise shell|bracket', '❵|right tortoise shell|bracket',
      '❨|left parenthesis hook|bracket', '❩|right parenthesis hook|bracket',
      '⟅|flattened parenthesis|bracket', '⟆|script parenthesis|bracket',
      '⏧|z notation schema punct|ornament', 'ᯓ|batak ornament|sparkle',
      '꧁|left ornament|frame decoration', '꧂|right ornament|frame decoration',
      '꧁꧂|ornament frame pair|frame decoration', '⸙|palm branch|leaf ornament',
      '☙❧|floral pair|fleuron frame', '❦⸙|leaf pair|fleuron',
      '✧･ﾟ|sparkle trailing|kawaii decoration', '･ﾟ✧|sparkle leading|kawaii decoration',
      '°˖✧|star burst string|decoration', '✧˖°|star string|decoration',
    ],
    stamp: [
      '♥|heart|love', '❤|heavy heart|love red', '🤍|white heart|love pale',
      '💔|broken heart|sad love grief', '💕|two hearts|love affection',
      '💞|revolving hearts|love', '💓|beating heart|love pulse',
      '💗|growing heart|love', '💖|sparkling heart|love joy',
      '💘|heart arrow|love crush', '💝|heart ribbon|love gift',
      '❤️‍🩹|mending heart|healing recovery', '🫀|anatomical heart|pulse dread',
      '🥀|wilted flower|grief melancholy', '🖤|black heart|love dark',
      '😭|loudly crying|cry sad face', '😅|sweat smile|awkward laugh face',
      '🥲|tear smile|bittersweet face', '😳|flushed|embarrassed blush face',
      '😢|crying|sad face tear', '🥺|pleading|begging face sad',
      '🫠|melting face|overwhelm', '🫥|dotted face|invisible ignored',
      '😤|triumph|huff steam face', '😠|angry face|mad',
      '😱|screaming|fear face', '😨|fearful|scared face',
      '🤯|mind blown|shock face', '😵|dizzy|knocked out',
      '😴|sleeping|tired face', '🥱|yawning|tired bored',
      '🤤|drooling|dazed desire', '🫣|peeking eye|shy hiding',
      '🫢|hand over mouth|gasp shock', '🤭|hand over mouth giggle|tease',
      '🤫|shushing|quiet secret', '🫡|salute|yes sir respect',
      '🤝|handshake|deal agreement', '🙏|folded hands|please thanks pray',
      '🤲|palms up|asking offer', '💪|flexed arm|strength',
      '👍|thumbs up|yes approve', '👎|thumbs down|no reject',
      '👌|ok hand|fine perfect', '✌|victory hand|peace',
      '🤞|crossed fingers|luck hope', '✍|writing hand|note scribe',
      '👁|eye|watch gaze', '👀|eyes|look watching',
      '💀|skull|dead face humor', '☠|skull crossbones|death danger',
      '👻|ghost|haunt spirit', '😈|devil smiling|mischief',
      '😈|imp|trickster', '🤡|clown|fool',
      '🔥|fire|burn passion scene', '⚡|lightning|storm bolt scene',
      '🌙|crescent moon|night scene weather', '🌑|new moon|night dark scene',
      '🌒|waxing crescent|moon phase', '🌔|waxing gibbous|moon phase',
      '🌕|full moon|night scene', '🌖|waning gibbous|moon phase',
      '🌗|last quarter|moon phase', '🌘|waning crescent|moon phase',
      '☀|sun|day weather scene', '🌤|sun behind cloud|weather scene',
      '⛅|sun behind large cloud|weather', '☁|cloud|weather sky',
      '🌧|rain|weather scene storm', '⛈|thunderstorm|weather storm scene',
      '🌩|cloud lightning|storm', '🌨|snow cloud|winter weather',
      '❄|snowflake|winter cold weather scene', '❅|tight snowflake|winter',
      '❆|heavy snowflake|winter', '⛄|snowman|winter',
      '🌊|wave|water sea scene', '💧|droplet|water tear',
      '🌫|fog|mist weather scene', '🌪|tornado|chaos storm',
      '🌈|rainbow|hope weather', '🍃|leaves|wind spring scene',
      '🍂|fallen leaves|autumn scene', '🍁|maple leaf|autumn scene',
      '🕯|candle|mood scene vigil', '☕|coffee|morning scene',
      '🩸|blood drop|injury gore scene', '💤|zzz|sleep',
      '💢|anger|rage mood', '🫂|hugging people|comfort embrace',
      '💐|bouquet|flowers gift', '🌹|rose|romance flower',
    ],
    gm: [
      '🎲|die|dice roll random d20', '🎯|bullseye|target goal',
      '⚔|crossed swords|battle fight combat', '🗡|dagger blade|weapon knife',
      '🛡|shield|defense armor', '🏹|bow|weapon arrow',
      '🪓|axe|weapon chop', '🔨|hammer|weapon tool',
      '⛏|pickaxe|tool mining', '🔫|gun|weapon firearm',
      '🔱|trident|spear weapon sea', '⚔️‍ lightning|storm blades|combat',
      '⚒|hammer pick|forge tool', '⚙|gear|machine mechanism',
      '🗝|key|lock treasure', '🔑|key|unlock door',
      '🔒|locked|sealed', '🔓|unlocked|open',
      '📜|scroll|quest letter document', '🗺|map|journey quest',
      '🧭|compass|direction navigate', '⚗|alembic|alchemy potion lab',
      '🕰|mantelpiece clock|time', '⏳|hourglass flowing|time wait',
      '⌛|hourglass done|time end', '⏰|alarm clock|deadline',
      '💰|money bag|treasure coin', '🪙|coin|money gold',
      '💎|gem stone|treasure jewel', '💍|ring|jewel vow',
      '👑|crown|king royalty', '🎩|top hat|noble gentry',
      '🎓|graduation cap|scholar', '🏆|trophy|victory prize',
      '🥇|gold medal|first victory', '🥈|silver medal|second',
      '🏰|castle|building keep', '🏯|castle japanese|building',
      '⛪|church|building sacred', '🕌|mosque|building sacred',
      '⛩|shrine gate|building sacred', '🕳|hole|dungeon pit',
      '🚪|door|entrance', '🪟|window|building',
      '🌉|bridge|crossing', '🗼|tower|building watch',
      '🏔|mountain snow|travel wild', '🌋|volcano|fire mountain',
      '🏝|desert island|travel sea', '🏜|desert|travel waste',
      '⛰|mountain|travel wild', '🌲|evergreen|forest',
      '🌳|tree|forest grove', '🌴|palm tree|tropic',
      '🌵|cactus|desert', '🍄|mushroom|forest fungus',
      '🐉|dragon|beast wyrm', '🐲|dragon face|beast wyrm',
      '🐺|wolf|beast pack', '🦇|bat|beast night',
      '🕷|spider|beast web', '🦂|scorpion|beast sting',
      '🐍|snake|serpent beast', '🦈|shark|beast sea',
      '🐙|octopus|beast sea', '🦑|squid|beast deep',
      '🦅|eagle|bird raptor', '🦉|owl|bird night wisdom',
      '🐴|horse|mount steed', '🐈|cat|familiar',
      '🐕|dog|companion hound', '🦌|deer|forest quarry',
      '🐻|bear|beast wild', '🦁|lion|beast king',
      '🐘|elephant|beast war', '🦌|stag|forest hunt',
      '🔮|crystal ball|scry magic', '🪄|magic wand|spell magic',
      '📿|prayer beads|faith ritual', '🧿|nazar amulet|ward evil eye',
      '⚗️|alchemy|potion lab', '🕯|black candle|ritual magic',
      '✨|sparkles|magic shine', '🌟|glowing star|magic blessing',
      '📖|open book|lore study', '📕|closed book|lore',
      '📗|green book|lore', '📘|blue book|lore',
      '📙|orange book|lore', '📓|notebook|journal',
      '📒|ledger|account', '🗒|spiral note|note',
      '📋|clipboard|list order', '📌|pushpin|mark note',
      '📍|round pin|location', '📎|paperclip|attach',
      '✂|scissors|cut edit', '🖋|fountain pen|write',
      '🖊|pen|write', '🖌|paintbrush|art',
      '🎨|palette|art', '🎼|musical score|music',
      '🎵|note|music', '🎶|notes|music',
      '⚠|warning|danger caution', '☠|poison|danger death',
      '🩹|bandage|injury heal', '🧪|test tube|alchemy experiment',
      '🧫|petri dish|experiment', '🔭|telescope|observe sky',
      '🔬|microscope|examine', '📡|satellite dish|signal',
    ],
    esoterica: [
      '☿|mercury|planet zodiac alchemy', '♀|venus|planet zodiac copper',
      '♂|mars|planet zodiac iron', '♃|jupiter|planet zodiac tin',
      '♄|saturn|planet zodiac lead', '♅|uranus|planet',
      '♆|neptune|planet sea', '♇|pluto|planet',
      '☉|sun|planet sol gold', '☽|waxing moon|moon phase',
      '☾|waning moon|moon phase', '☿|hermes|alchemy mercury',
      '☄|comet|sky falling star', '🌠|shooting star|wish sky',
      '🌑|new moon symbol|moon', '🌒|waxing crescent symbol|moon',
      '♈|aries|zodiac ram', '♉|taurus|zodiac bull',
      '♊|gemini|zodiac twins', '♋|cancer|zodiac crab',
      '♌|leo|zodiac lion', '♍|virgo|zodiac maiden',
      '♎|libra|zodiac scales', '♏|scorpio|zodiac scorpion',
      '♐|sagittarius|zodiac archer', '♑|capricorn|zodiac goat',
      '♒|aquarius|zodiac water bearer', '♓|pisces|zodiac fish',
      '🜁|alchemy air|element', '🜂|alchemy fire|element',
      '🜃|alchemy earth|element', '🜄|alchemy water|element',
      '🜍|alchemy sulfur|brimstone', '🜏|sulfur crossed|occult leviathan',
      '🜔|alchemy salt|body earth', '🜚|alchemy gold|aurum',
      '🜛|alchemy silver|luna', '🜜|alchemy copper|venus metal',
      '🜖|alchemy iron|mars metal', '🜗|alchemy tin|jupiter metal',
      '🜘|alchemy lead|saturn metal', '🜙|alchemy antimony|wolf metal',
      '🜒|arsenic|alchemy poison', '🜓|sulfur variant|alchemy',
      '🜕|sal ammoniac|alchemy', '🜚|gold circle|aurum',
      '⚚|staff of hermes|caduceus', '⚕|medical staff|healing rod',
      '⚛|atom|science', '☥|ankh|egypt life',
      '☧|chi rho|sacred christ', '✝|latin cross|sacred grave',
      '✞|shadowed cross|sacred', '✟|outlined cross|sacred',
      '✠|cross of jerusalem|sacred knight', '☩|cross of lorraine|sacred',
      ' Evel|placeholder|', '⛧|inverse pentagram|occult dark',
      '⛥|pentagram outline|occult', '⛨|shield knot|protection',
      '🜏|sulfur mark|occult', '🝊|conjunction|alchemy join',
      '🜷|quicksilver|alchemy mercury', '🜹|sublimate|alchemy',
      '🝕|crucible|alchemy melt', '🝖|retort|alchemy still',
      '🜺|wax|alchemy seal', '🝛|soap|alchemy cleanse',
      'ᚠ|fehu rune|wealth rune', 'ᚢ|uruz rune|strength aurochs rune',
      'ᚦ|thurisaz rune|thorn giant rune', 'ᚨ|ansuz rune|odin speech rune',
      'ᚱ|raido rune|journey ride rune', 'ᚲ|kenaz rune|torch rune',
      'ᚷ|gebo rune|gift rune', 'ᚹ|wunjo rune|joy rune',
      'ᚺ|hagalaz rune|hail rune', 'ᚾ|naudiz rune|need rune',
      'ᛁ|isa rune|ice rune', 'ᛃ|jera rune|harvest year rune',
      'ᛇ|eihwaz rune|yew rune', 'ᛈ|perthro rune|fate lot rune',
      'ᛉ|algiz rune|protection elk rune', 'ᛊ|sowilo rune|sun rune',
      'ᛏ|tiwaz rune|victory tyr rune', 'ᛒ|berkana rune|birch rune',
      'ᛖ|ehwaz rune|horse rune', 'ᛗ|mannaz rune|man rune',
      'ᛚ|laguz rune|water lake rune', 'ᛜ|ingwaz rune|seed rune',
      'ᛞ|dagaz rune|day rune', 'ᛟ|othala rune|heritage rune',
      'α|alpha|greek beginning', 'β|beta|greek', 'γ|gamma|greek',
      'δ|delta|greek change', 'ε|epsilon|greek', 'ζ|zeta|greek',
      'η|eta|greek', 'θ|theta|greek', 'ι|iota|greek',
      'κ|kappa|greek', 'λ|lambda|greek', 'μ|mu|greek',
      'ν|nu|greek', 'ξ|xi|greek', 'ο|omicron|greek',
      'π|pi|greek circle', 'ρ|rho|greek', 'σ|sigma|greek sum',
      'τ|tau|greek', 'υ|upsilon|greek', 'φ|phi|greek golden',
      'χ|chi|greek cross', 'ψ|psi|greek mind', 'ω|omega|greek end',
      'Ω|capital omega|greek end', 'ॐ|om|sacred hindu vibration',
      '☯|yin yang|balance tao', '☸|dharma wheel|buddhist',
      '☮|peace|harmony', '♾|infinity heart|endless',
    ],
    marks: [
      '→|right arrow|point direction', '←|left arrow|point direction',
      '↔|left-right arrow|direction', '↕|up-down arrow|direction',
      '⇒|double arrow right|implies direction', '⇐|double arrow left|implies',
      '⇔|double left-right|iff direction', '⇑|double up|direction',
      '⇓|double down|direction', '↗|up-right arrow|direction',
      '↘|down-right arrow|direction', '↖|up-left arrow|direction',
      '↙|down-left arrow|direction', '↦|maps to|function arrow',
      '↪|rightwards hook|hook arrow', '↩|leftwards hook|hook arrow return',
      '⇄|right-left arrows|swap exchange', '⇆|left-right arrows|swap',
      '➜|heavy round-tipped right|bold arrow', '➔|heavy rightwards|bold arrow',
      '➘|heavy down-right|arrow corner', '➙|heavy right long|arrow',
      '➛|drafting right|arrow sketch', '➝|thin right|arrow light',
      '➞|heavy triangle right|arrow barbed', '➤|black rightwards arrowhead|point',
      '➧|squiggle right|arrow wave', '⟶|long rightwards|arrow long',
      '⟵|long leftwards|arrow long', '⟷|long left-right|arrow long',
      '↞|two-headed left|arrow double', '↠|two-headed right|arrow double',
      '⇢|rightwards dashed|arrow ghost', '⇣|downwards dashed|arrow ghost',
      '⇡|upwards dashed|arrow ghost', '⇥|rightwards to bar|arrow tab',
      '⇤|leftwards to bar|arrow tab', '↤|leftwards from bar|arrow',
      '⤳|rightwards with corner|arrow bend', '⇉|two rightwards|arrow repeat',
      '⇶|three rightwards|arrow fast', '⇵|downwards up|arrow flow',
      '✓|check|yes done mark', '✔|heavy check|yes done mark',
      '✗|cross mark|no wrong', '✘|heavy cross|no wrong x',
      '☑|checkbox checked|done select', '☒|checkbox crossed|rejected',
      '⍻|check mark pending|verify', '☑️|ballot check|vote done',
      '±|plus-minus|math approx', '×|multiplication|math x',
      '÷|division|math divide', '≈|almost equal|math approx wave',
      '≠|not equal|math', '≡|identical|math same',
      '≤|less equal|math', '≥|greater equal|math',
      '∞|infinity|math endless', '∑|summation|math total',
      '∏|product|math total', '√|square root|math radical',
      '∂|partial|math derivative', '∆|increment|math delta change',
      '∇|nabla|math gradient', '∫|integral|math',
      'π|pi|math circle greek', 'µ|micro|si small',
      'Ω|ohm|resistance greek', '∴|therefore|logic thus',
      '∵|because|logic since', '∷|ratio|proportion logic',
      '¬|not|logic negation', '∧|logical and|logic',
      '∨|logical or|logic', '⊕|circled plus|logic xor',
      '⊤|down tack|logic true', '⊨|true|logic satisfies',
      '∀|for all|logic universal', '∃|there exists|logic',
      '∈|element of|set member', '∉|not element of|set',
      '⊂|subset|set', '⊃|superset|set',
      '∪|union|set join', '∩|intersection|set overlap',
      '∅|empty set|set null void', '∘|ring operator|compose function',
      '⌘|place of interest|command mark', '⌥|option key|mark',
      '⎋|escape key|mark', '⏎|return key|enter mark',
      '⌫|delete left|backspace mark', '␣|open box|space blank',
      '⌦|delete right|mark', '⏏|eject|mark',
      '©|copyright|law', '®|registered|law',
      '™|trademark|law', '℗|phonogram|law sound',
      '℅|care of|address', '℔|pound mark|law lb',
      '№|numero|number', '‱|per ten thousand|percent',
      '‽|interrobang|question exclaim', '⁇|double question|confusion',
      '⁈|question exclamation|disbelief', '‼|double exclamation|shock',
      '⁉|exclamation question|huh', '〃|ditto|repeat',
      '⌇|wavy|squiggle mark', '⌁|electric arrow|energy',
    ],
  };

  const GROUPS = [];
  for (const id of ['type', 'breaks', 'ornament', 'stamp', 'gm', 'esoterica', 'marks']) {
    const labels = { type: 'Type', breaks: 'Breaks', ornament: 'Ornaments', stamp: 'Stamps', gm: 'GM', esoterica: 'Esoterica', marks: 'Marks' };
    GROUPS.push({
      id: id, label: labels[id], page: 0,
      items: DATA[id].map(function (s) {
        const p = s.split('|');
        return { c: p[0], n: p[1], k: p[2] || '' };
      }).filter(function (it) { return it.c && it.n && it.n !== 'placeholder'; }),
    });
  }
  const PAGE = 32;

  // ---- state ----
  let pop = null, tab = 'type', query = '', recents = [];
  try { recents = JSON.parse(localStorage.getItem('sigil_recents') || '[]'); } catch (e) { recents = []; }
  function saveRecents() { try { localStorage.setItem('sigil_recents', JSON.stringify(recents)); } catch (e) {} }

  function allItems() { return GROUPS.reduce(function (a, g) { return a.concat(g.items); }, []); }

  function insert(str) {
    const input = document.getElementById('input');
    if (!input) return;
    const s = input.selectionStart != null ? input.selectionStart : input.value.length;
    const e = input.selectionEnd != null ? input.selectionEnd : s;
    const isPair = str.length === 2 && !/\s/.test(str);
    input.value = input.value.slice(0, s) + str + input.value.slice(e);
    const caret = s + (isPair ? 1 : str.length);
    input.focus();
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    recents = [str].concat(recents.filter(function (r) { return r !== str; })).slice(0, 16);
    saveRecents();
    renderGrid();
  }

  function renderGrid() {
    if (!pop) return;
    const grid = pop.querySelector('.sigil-grid');
    const recRow = pop.querySelector('.sigil-recents');
    const pager = pop.querySelector('.sigil-pager');
    grid.replaceChildren();
    recRow.replaceChildren();
    recRow.hidden = !!query;
    if (!query && recents.length) {
      recents.forEach(function (r) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sigil-cell'; b.textContent = r;
        b.title = 'recent';
        b.addEventListener('click', function () { insert(r); });
        recRow.appendChild(b);
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      pager.hidden = true;
      const items = allItems().filter(function (it) { return (it.n + ' ' + it.k + ' ' + it.c).toLowerCase().indexOf(q) >= 0; }).slice(0, 120);
      items.forEach(function (it) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sigil-cell'; b.textContent = it.c; b.title = it.n;
        b.addEventListener('click', function () { insert(it.c); });
        grid.appendChild(b);
      });
      if (!items.length) {
        const e = document.createElement('div');
        e.className = 'sigil-empty';
        e.textContent = 'Nothing matches "' + query + '"';
        grid.appendChild(e);
      }
      return;
    }
    const g = GROUPS.find(function (x) { return x.id === tab; }) || GROUPS[0];
    const pages = Math.max(1, Math.ceil(g.items.length / PAGE));
    if (g.page >= pages) g.page = 0;
    pager.hidden = pages <= 1;
    pager.querySelector('.sigil-page').textContent = (g.page + 1) + ' / ' + pages;
    pager.querySelector('.sigil-prev').disabled = g.page === 0;
    pager.querySelector('.sigil-next').disabled = g.page >= pages - 1;
    g.items.slice(g.page * PAGE, g.page * PAGE + PAGE).forEach(function (it) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sigil-cell'; b.textContent = it.c; b.title = it.n;
      b.addEventListener('click', function () { insert(it.c); });
      grid.appendChild(b);
    });
  }

  function renderTabs() {
    if (!pop) return;
    const tabs = pop.querySelector('.sigil-tabs');
    tabs.replaceChildren();
    GROUPS.forEach(function (g) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sigil-tab' + (g.id === tab && !query ? ' on' : '');
      b.textContent = g.label;
      b.addEventListener('click', function () { tab = g.id; g.page = 0; query = ''; pop.querySelector('.sigil-search').value = ''; renderTabs(); renderGrid(); });
      tabs.appendChild(b);
    });
  }

  function close() {
    if (pop) { pop.remove(); pop = null; }
    const btn = document.getElementById('sigilBtn');
    if (btn) btn.classList.remove('on');
  }

  function open(btn) {
    close();
    pop = document.createElement('div');
    pop.className = 'sigil-pop';
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 340, r.right - 320)) + 'px';
    pop.style.top = Math.max(8, r.top - 396) + 'px';

    const search = document.createElement('input');
    search.type = 'text'; search.className = 'sigil-search';
    search.placeholder = 'Search sigils — "dash", "divider", "moon"…';
    search.value = query;
    search.addEventListener('input', function () { query = search.value; renderTabs(); renderGrid(); });
    const tabs = document.createElement('div'); tabs.className = 'sigil-tabs';
    const recRow = document.createElement('div'); recRow.className = 'sigil-recents';
    const grid = document.createElement('div'); grid.className = 'sigil-grid';
    const pager = document.createElement('div'); pager.className = 'sigil-pager';
    const prev = document.createElement('button'); prev.type = 'button'; prev.className = 'sigil-prev'; prev.textContent = '‹';
    prev.title = 'Previous page';
    const pageLabel = document.createElement('span'); pageLabel.className = 'sigil-page';
    const next = document.createElement('button'); next.type = 'button'; next.className = 'sigil-next'; next.textContent = '›';
    next.title = 'Next page';
    prev.addEventListener('click', function () { const g = GROUPS.find(function (x) { return x.id === tab; }); if (g && g.page > 0) { g.page--; renderGrid(); } });
    next.addEventListener('click', function () { const g = GROUPS.find(function (x) { return x.id === tab; }); if (g) { g.page++; renderGrid(); } });
    pager.appendChild(prev); pager.appendChild(pageLabel); pager.appendChild(next);
    const hint = document.createElement('div'); hint.className = 'sigil-hint';
    hint.textContent = 'Click to insert at the caret · stays open · Esc closes';
    pop.appendChild(search); pop.appendChild(tabs); pop.appendChild(recRow); pop.appendChild(grid); pop.appendChild(pager); pop.appendChild(hint);
    document.body.appendChild(pop);
    btn.classList.add('on');

    const out = function (ev) { if (pop && !pop.contains(ev.target) && ev.target !== btn) { close(); document.removeEventListener('mousedown', out); } };
    setTimeout(function () { document.addEventListener('mousedown', out); }, 0);
    pop.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
    search.focus();
    renderTabs(); renderGrid();
  }

  function init() {
    const btn = document.getElementById('sigilBtn');
    if (!btn) return;
    btn.addEventListener('click', function () { if (pop) close(); else open(btn); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && pop) close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { open: open, close: close };
})();
