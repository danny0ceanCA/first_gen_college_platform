// FSA articles do not share the main site's /es route structure.
// Use verified Spanish guidance or the Spanish resource library instead.
const spanishSources: Record<string, { url: string; label: string }> = {
  'https://studentaid.gov/apply-for-aid/fafsa/filling-out': {
    url: 'https://studentaid.gov/es/apply-for-aid/fafsa/filling-out',
    label: 'Ayuda Federal para Estudiantes · Cómo llenar la FAFSA',
  },
  'https://studentaid.gov/articles/fafsa-submission-summary/': {
    url: 'https://studentaid.gov/es/apply-for-aid/fafsa/filling-out#sign-submit',
    label: 'Ayuda Federal para Estudiantes · Envío y resultados de la FAFSA',
  },
  'https://studentaid.gov/articles/financial-aid-dictionary/': {
    url: 'https://studentaid.gov/es/resources',
    label: 'Ayuda Federal para Estudiantes · Recursos en español',
  },
  'https://studentaid.gov/articles/evaluating-financial-aid-offers/': {
    url: 'https://studentaid.gov/es/resources',
    label: 'Ayuda Federal para Estudiantes · Recursos en español',
  },
};

export function financialAidSource(url: string, label: string, language: 'en' | 'es') {
  return language === 'es' && spanishSources[url] ? spanishSources[url] : { url, label };
}
