const I18N = {
  ar: {
    appTitle: 'ريل ستوديو', tagline: 'استوديو موشن جرافيك شخصي', save: 'حفظ المشروع',
    script: 'السكريبت', scriptPh: 'اكتب أو الصق السكريبت هنا… كل فقرة هتتحول لمشهد.',
    analyze: 'حلّل إلى مشاهد', analyzeHint: 'تحليل محلي، مش محتاج مفتاح API',
    vo: 'التعليق الصوتي', genVo: 'ولّد تعليق صوتي', orUpload: 'أو ارفع تعليق جاهز',
    keyOk: 'مفتاح Gemini متوفر — التوليد بالذكاء الاصطناعي شغال',
    keyMissing: 'مفيش مفتاح Gemini — التوليد بالـ AI متعطّل، لكن رفع تعليق جاهز شغال',
    sound: 'الصوتيات', music: 'موسيقى خلفية', musicVol: 'مستوى الموسيقى',
    sfx: 'مؤثرات صوتية عند الانتقالات', duckHint: 'الموسيقى بتنخفض تلقائيًا تحت التعليق الصوتي',
    scenes: 'المشاهد', mediaLib: 'مكتبة الميديا',
    drop: 'اسحب صور / فيديو / لوجو هنا أو اضغط للاختيار',
    export: 'التصدير', preset: 'الستايل البصري', aspect: 'المقاس',
    render: 'رندر الفيديو', download: 'تحميل MP4',
    templates: 'قوالب جاهزة', timeline: 'التايم لاين', timelineHint: 'عرض كل مشهد حسب مدته — اضغط على مشهد للانتقال له', sec: 'ث',
    captionSugg: 'كابشن جاهز للنشر', copyCaption: 'نسخ الكابشن', captionCopied: 'اتنسخ ✅', thumbTitle: 'صورة الغلاف', downloadThumb: 'تحميل الغلاف',
    noMusic: 'بدون موسيقى', noMedia: 'بدون ميديا', dur: 'المدة (ث)', trim: 'بداية القص (ث)',
    logoMode: 'وضع اللوجو (خلفية سوداء)', preview: 'معاينة',
    rendering: 'بيترندر…', done: 'جاهز!', error: 'حصل خطأ',
    presets: { cinematic: 'سينمائي', sports: 'رياضي', minimal: 'بسيط', club: 'نادي أوروبي' },
    aspects: { '9:16': 'ريل 9:16', '1:1': 'مربع 1:1', '16:9': 'عرضي 16:9' },
    voReady: 'التعليق الصوتي جاهز', voFail: 'فشل توليد الصوت', noScenes: 'حلّل السكريبت الأول',
    newProject: '— مشروع جديد —', savedOk: 'اتحفظ', projectName: 'اسم المشروع؟',
  },
  en: {
    appTitle: 'Reel Studio', tagline: 'Personal motion graphics studio', save: 'Save project',
    script: 'Script', scriptPh: 'Write or paste your script… each paragraph becomes a scene.',
    analyze: 'Break into scenes', analyzeHint: 'Local analysis, no API key needed',
    vo: 'Voiceover', genVo: 'Generate voiceover', orUpload: 'or upload a ready voiceover',
    keyOk: 'Gemini key set - AI generation available',
    keyMissing: 'No Gemini key - AI generation off, uploaded voiceover still works',
    sound: 'Sound', music: 'Background music', musicVol: 'Music volume',
    sfx: 'Transition sound effects', duckHint: 'Music auto-ducks under the voiceover',
    scenes: 'Scenes', mediaLib: 'Media library',
    drop: 'Drag images / videos / logos here or click to choose',
    export: 'Export', preset: 'Visual style', aspect: 'Aspect',
    render: 'Render video', download: 'Download MP4',
    templates: 'Templates', timeline: 'Timeline', timelineHint: 'Each scene sized by its duration — tap to jump to it', sec: 's',
    captionSugg: 'Caption ready to post', copyCaption: 'Copy caption', captionCopied: 'Copied ✅', thumbTitle: 'Cover image', downloadThumb: 'Download cover',
    noMusic: 'No music', noMedia: 'No media', dur: 'Duration (s)', trim: 'Trim start (s)',
    logoMode: 'Logo mode (dark card)', preview: 'Preview',
    rendering: 'Rendering…', done: 'Done!', error: 'Error',
    presets: { cinematic: 'Cinematic', sports: 'Sports', minimal: 'Minimal', club: 'Euro Club' },
    aspects: { '9:16': 'Reel 9:16', '1:1': 'Square 1:1', '16:9': 'Wide 16:9' },
    voReady: 'Voiceover ready', voFail: 'Voiceover failed', noScenes: 'Analyze the script first',
    newProject: '— New project —', savedOk: 'Saved', projectName: 'Project name?',
  },
};

let LANG = localStorage.getItem('rs-lang') || 'ar';
function t(key) {
  const dict = I18N[LANG] || I18N.ar;
  return dict[key] ?? I18N.ar[key] ?? key;
}
function applyI18n() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  const btn = document.getElementById('langToggle');
  if (btn) btn.textContent = LANG === 'ar' ? 'English' : 'عربي';
}
