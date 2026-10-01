import { financialAidSource } from './financialAidLinks';
import { ChevronDown, ExternalLink } from 'lucide-react';
import './CollegeFinance.css';

const steps = [
  {
    title: ['Your family’s financial picture', 'La situación económica de tu familia'],
    body: ['Paying for college starts with understanding your family’s financial situation. For a student who is considered dependent under financial aid rules, that generally includes both the student’s and their parents’ income, along with family size and certain assets. Your income is one part of the calculation; it does not, by itself, tell you how much aid your student will receive or how much college will cost your family.', 'Pagar la universidad comienza con entender la situación económica de tu familia. Para un estudiante considerado dependiente según las reglas de ayuda económica, generalmente se incluyen los ingresos del estudiante y de sus padres, el tamaño de la familia y ciertos bienes. Los ingresos son solo una parte del cálculo: por sí solos no determinan cuánta ayuda recibirá tu estudiante ni cuánto pagará tu familia.'],
    url: 'https://studentaid.gov/apply-for-aid/fafsa/filling-out', source: 'Federal Student Aid',
  },
  {
    title: ['Applying for aid through FAFSA', 'Solicitar ayuda con la FAFSA'],
    body: ['Your student applies for financial aid by completing the Free Application for Federal Student Aid, or FAFSA. The student and any required parent contributors complete their own sections and give permission for federal tax information to transfer from the IRS. The application is submitted to the U.S. Department of Education. Completing FAFSA does not mean you are taking out a loan or agreeing to pay a particular amount.', 'Tu estudiante solicita ayuda económica mediante la Solicitud Gratuita de Ayuda Federal para Estudiantes, o FAFSA. El estudiante y los padres que deban participar completan sus propias secciones y autorizan la transferencia de información tributaria federal del IRS. La solicitud se envía al Departamento de Educación de Estados Unidos. Completar la FAFSA no significa aceptar un préstamo ni comprometerse a pagar una cantidad determinada.'],
    url: 'https://studentaid.gov/apply-for-aid/fafsa/filling-out', source: 'Federal Student Aid',
  },
  {
    title: ['What happens after you submit', 'Qué pasa después de enviarla'],
    body: ['After the FAFSA is processed, your student receives a FAFSA Submission Summary. It includes a number called the Student Aid Index, or SAI, which helps colleges determine financial aid eligibility. The SAI is not your college bill or the amount your family is required to pay. The colleges listed on the FAFSA also receive the application information so they can consider your student for aid.', 'Después de procesar la FAFSA, tu estudiante recibe un resumen de la solicitud. Incluye el Índice de Ayuda Estudiantil, o SAI, un número que ayuda a las universidades a determinar la elegibilidad para ayuda económica. El SAI no es la factura de la universidad ni la cantidad que tu familia debe pagar. Las universidades indicadas en la FAFSA también reciben la información para considerar a tu estudiante para recibir ayuda.'],
    url: 'https://studentaid.gov/articles/fafsa-submission-summary/', source: 'Federal Student Aid',
  },
  {
    title: ['Understanding cost of attendance', 'Entender el costo de asistencia'],
    body: ['Each college has its own cost of attendance: an estimated budget for attending that school, usually for one academic year. It includes tuition and fees, housing and food, books and supplies, transportation, and other personal expenses. Some of these costs may appear on the college’s bill, while others are expenses your student pays separately. This is why the cost of attendance is larger than tuition alone.', 'Cada universidad tiene su propio costo de asistencia: un presupuesto estimado para estudiar allí, generalmente durante un año académico. Incluye matrícula y cuotas, vivienda y comida, libros y materiales, transporte y otros gastos personales. Algunos costos aparecen en la factura de la universidad; otros se pagan por separado. Por eso el costo de asistencia es mayor que la matrícula por sí sola.'],
    url: 'https://studentaid.gov/articles/financial-aid-dictionary/', source: 'Federal Student Aid',
  },
  {
    title: ['How the college builds an aid offer', 'Cómo prepara la universidad su oferta de ayuda'],
    body: ['The college uses your student’s financial aid information, its cost of attendance, and the rules and funding available for different aid programs to put together a financial aid offer. That offer may include grants and scholarships, which generally do not need to be repaid; loans, which must be repaid; and work-study, which your student earns through an eligible job. The amounts and types of aid can differ from one college to another.', 'La universidad utiliza la información económica de tu estudiante, su costo de asistencia y las reglas y los fondos disponibles de distintos programas para preparar una oferta de ayuda. Puede incluir becas y subvenciones, que generalmente no se devuelven; préstamos, que sí se deben devolver; y trabajo y estudio, que el estudiante gana mediante un empleo elegible. Las cantidades y los tipos de ayuda pueden variar entre universidades.'],
    url: 'https://studentaid.gov/articles/evaluating-financial-aid-offers/', source: 'Federal Student Aid',
  },
  {
    title: ['What your family still needs to cover', 'Lo que todavía debe cubrir tu familia'],
    body: ['To understand what your family still needs to cover, subtract grants and scholarships from the college’s cost of attendance. The remaining amount is called the net price. For example, if the estimated yearly cost is $30,000 and your student receives $12,000 in grants and scholarships, the net price is $18,000. A loan can help cover that amount, but it does not reduce the price—it moves some of the payment into the future.', 'Para entender lo que tu familia todavía debe cubrir, resta las becas y subvenciones del costo de asistencia. El resultado se llama precio neto. Por ejemplo, si el costo anual estimado es de $30,000 y tu estudiante recibe $12,000 en becas y subvenciones, el precio neto es de $18,000. Un préstamo puede ayudar a cubrir esa cantidad, pero no reduce el precio: deja parte del pago para el futuro.'],
    url: 'https://studentaid.gov/articles/evaluating-financial-aid-offers/', source: 'Federal Student Aid',
  },
  {
    title: ['Another application for eligible California students', 'Otra solicitud para estudiantes elegibles de California'],
    body: ['In California, some students who are not eligible to complete FAFSA may qualify to apply for state and certain college financial aid through the California Dream Act Application. Families should check which application fits their student’s eligibility before starting.', 'En California, algunos estudiantes que no son elegibles para completar la FAFSA pueden solicitar ayuda estatal y de ciertas universidades mediante la Solicitud de la Ley del Sueño de California (California Dream Act Application). Antes de comenzar, las familias deben verificar qué solicitud corresponde a la elegibilidad de su estudiante.'],
    url: 'https://csac.ca.gov/cadaa-faq', source: 'California Student Aid Commission',
  },
];

export default function CollegeFinance({ language }: { language: 'en' | 'es' }) {
  const index = language === 'es' ? 1 : 0;
  return <section className="finance-guide" aria-label={index ? 'Cómo funciona la ayuda económica' : 'How college financial aid works'}>
    <p className="finance-guide-intro">{index ? 'De las finanzas de tu familia al pago de la universidad. Abre cada tarjeta para conocer el proceso.' : 'From your family’s finances to paying for college. Open each card to follow the process.'}</p>
    <ol className="finance-cards">
      {steps.map((step, number) => { const source = financialAidSource(step.url, step.source, language); return <li key={step.url + number}>
        <details className="finance-card">
          <summary><span className="finance-number" aria-hidden="true">{number + 1}</span><h2>{step.title[index]}</h2><ChevronDown className="finance-chevron" size={20} aria-hidden="true"/></summary>
          <div className="finance-card-content"><p>{step.body[index]}</p><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLink size={14} aria-hidden="true"/><span className="visually-hidden">{index ? ' (se abre en otra pestaña)' : ' (opens in a new tab)'}</span></a></div>
        </details>
      </li>; })}
    </ol>
  </section>;
}
