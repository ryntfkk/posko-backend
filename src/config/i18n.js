const path = require('path');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');

i18next
  .use(Backend)
  .use(middleware.LanguageDetector)
  .init({
    fallbackLng: 'id',
    preload: ['id', 'en'],
    supportedLngs: ['id', 'en'],
    ns: ['translation'],
    defaultNS: 'translation',
    backend: {
      loadPath: path.join(__dirname, '..', 'locales', '{{lng}}', '{{ns}}.json'),
    },
    detection: {
      order: ['querystring', 'header'],
      lookupQuerystring: 'lang',
      lookupHeader: 'accept-language',
    },
    interpolation: { escapeValue: false },
  });

module.exports = {
  i18next,
  i18nMiddleware: middleware.handle(i18next),
};