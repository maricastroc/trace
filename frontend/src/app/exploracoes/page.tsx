import Link from "next/link";

export const metadata = { title: "Trace · Explorações de direção" };

const PROPOSALS = [
  {
    id: "a",
    name: "A · Reportagem",
    thesis: "O resultado como manchete; a origem contada em capítulos.",
    color: "#d23f1c",
    points: [
      ["Primeira tela", "Os resultados em tipografia monumental — o tamanho de cada número acompanha seu valor — com a pergunta “De onde veio esse número?”."],
      ["Protagonista", "Os próprios números. A tela parece a abertura de uma reportagem de dados, não um painel."],
      ["Como começa a investigação", "Um clique no número. Ele vira um bloco de cor inteiro e a página se desdobra em seis capítulos: o número, os registros, as cozinhas, o caminho, o que ficou de fora e os dados originais."],
      ["Como a linhagem aparece", "Progressivamente, em linguagem simples: um quadro por registro, barras por cozinha, uma escada de passos comparando o total com a parte deste resultado, e as exclusões com o motivo registrado."],
      ["Identidade", "Editorial: papel claro, preto profundo, um vermelho-vermelhão dominante, serifa expressiva em escala de manchete."],
      ["Benefícios", "A mais legível para quem não conhece engenharia de dados. Usa apenas endpoints existentes. Escala bem em número de resultados e de passos."],
      ["Limitações", "Narrativa linear: a visão do conjunto (todos os fluxos de uma vez) é fraca. Com muitos registros, o capítulo de quadros precisa de agregação."],
    ],
  },
  {
    id: "b",
    name: "B · Rio",
    thesis: "Uma única imagem mostra para onde foi cada registro.",
    color: "#2b4be0",
    points: [
      ["Primeira tela", "Um rio de ponta a ponta: as refeições entram à esquerda, estreitam-se a cada transformação e deságuam nos municípios, com os números grandes à direita."],
      ["Protagonista", "O fluxo proporcional. Largura é contagem real; as exclusões caem em poças com o motivo."],
      ["Como começa a investigação", "Clicando num município. Sua faixa se acende até a fonte, as outras recuam, e as refeições do município que ficaram de fora caem na poça com a sua cor."],
      ["Como a linhagem aparece", "Como um diagrama de fluxo honesto: a cor de um município só aparece onde o dado sabe o destino; o que saiu antes da junção continua neutro."],
      ["Identidade", "Cartaz: grotesca condensada em negrito, paleta saturada por destino sobre papel claro."],
      ["Benefícios", "O maior impacto à primeira vista e a melhor visão do todo: perdas, junção e destinos numa só composição."],
      ["Limitações", "Perde legibilidade com muitos destinos (paleta) e muitos passos; difícil no celular; hoje exige uma chamada à API por município."],
    ],
  },
  {
    id: "c",
    name: "C · Arquivo",
    thesis: "Cada registro é visível; os números são feitos deles.",
    color: "#1c2320",
    points: [
      ["Primeira tela", "Os 118 registros como quadrados, agrupados pelo destino: municípios em tinta, exclusões vazadas em vermelho, agrupadas pelo passo em que saíram."],
      ["Protagonista", "Os registros individuais. A frase do produto vira literal: o número é composto de peças que se pode tocar."],
      ["Como começa a investigação", "Pelo município ou por qualquer quadrado. O município reorganiza seus registros por cozinha, ao lado dos que ficaram de fora; o quadrado abre uma ficha com carimbo."],
      ["Como a linhagem aparece", "Como movimento: o modo passo a passo reexecuta a receita diante do usuário, e os registros saem do bloco no passo exato em que foram excluídos."],
      ["Identidade", "Arquivo forense: papel kraft, fichas, carimbos, monoespaçada para metadados, serifa para as conclusões."],
      ["Benefícios", "A mais memorável e a melhor para “por que este registro não aparece?”. Tátil e lúdica sem perder a precisão."],
      ["Limitações", "Não escala sem agregação (“1 quadrado = N registros” enfraquece a ideia). Junções que multiplicam registros complicam “1 quadrado = 1 registro”. Precisa de um endpoint novo."],
    ],
  },
] as const;

export default function Page() {
  return (
    <main className="min-h-dvh px-[6vw] pt-16 pb-32" style={{ background: "#f3eee4", color: "#161513" }}>
      <p className="text-[15px] font-medium tracking-[0.12em] uppercase" style={{ color: "#a92e12" }}>
        Trace · explorações de direção
      </p>
      <h1 className="mt-4 max-w-[18ch] font-display text-[clamp(52px,6.4vw,100px)] leading-[0.95] tracking-[-0.02em]">Três maneiras de contar de onde vem um número.</h1>
      <p className="mt-6 max-w-[64ch] text-[20px] leading-[1.55]" style={{ color: "#3d3933" }}>
        Os três protótipos usam a mesma execução, a mesma API do Laravel e nenhum número inventado. Eles mostram a primeira tela e o momento da investigação — não são a implementação final.
      </p>

      <div className="mt-16 grid gap-12 xl:grid-cols-3">
        {PROPOSALS.map((p) => (
          <section key={p.id} className="flex flex-col border-t-[6px] pt-6" style={{ borderColor: p.color }}>
            <h2 className="font-display text-[46px] leading-none">{p.name}</h2>
            <p className="mt-3 font-display text-[26px] leading-[1.15]" style={{ color: "#3d3933" }}>
              {p.thesis}
            </p>
            <Link href={p.id === "b" ? "/" : `/exploracoes/${p.id}`} className="mt-6 self-start rounded-full px-6 py-3 text-[17px] font-medium" style={{ background: p.color, color: "#fbf6ee" }}>
              {p.id === "b" ? "Abrir — agora é a interface principal →" : `Abrir protótipo ${p.id.toUpperCase()} →`}
            </Link>
            <dl className="mt-8 space-y-5">
              {p.points.map(([term, text]) => (
                <div key={term}>
                  <dt className="text-[14px] font-semibold tracking-[0.1em] uppercase" style={{ color: "#625c52" }}>
                    {term}
                  </dt>
                  <dd className="mt-1 text-[18px] leading-[1.5]">{text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <section className="mt-24 max-w-[980px] border-t-2 pt-10" style={{ borderColor: "#161513" }}>
        <h2 className="font-display text-[56px] leading-none">Avaliação crítica</h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[18px]">
            <thead>
              <tr className="text-[14px] tracking-[0.1em] uppercase" style={{ color: "#625c52" }}>
                <th className="pb-3 font-semibold">critério</th>
                <th className="pb-3 font-semibold">A · Reportagem</th>
                <th className="pb-3 font-semibold">B · Rio</th>
                <th className="pb-3 font-semibold">C · Arquivo</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Impacto na primeira tela", "alto", "muito alto", "alto"],
                ["Clareza para leigos", "muito alta", "média", "alta (em escala pequena)"],
                ["Visão do todo", "baixa", "muito alta", "alta"],
                ["“Por que ficou de fora?”", "alta", "média", "muito alta"],
                ["Escala (mais dados, passos, grupos)", "alta", "média", "baixa"],
                ["Celular", "boa", "difícil", "média"],
                ["Viabilidade com a API atual", "total", "parcial (N chamadas)", "parcial (novo endpoint)"],
              ].map((row) => (
                <tr key={row[0]} style={{ borderTop: "1px solid rgba(22,21,19,.14)" }}>
                  {row.map((cell, i) => (
                    <td key={i} className={`py-3 pr-6 ${i === 0 ? "font-medium" : ""}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-10 font-display text-[34px] leading-[1.2]">
          Recomendação: a estrutura da <span style={{ color: "#d23f1c" }}>Reportagem</span>, com o <span style={{ color: "#2b4be0" }}>Rio</span> como a peça central do capítulo “O caminho” e os quadros do <span>Arquivo</span> nos capítulos de registros e exclusões.
        </p>
        <p className="mt-6 text-[19px] leading-[1.6]" style={{ color: "#3d3933" }}>
          A Reportagem resolve o problema que mais pesou — o visitante entender o valor antes dos detalhes — e é a única que escala com segurança e roda com a API atual. Sozinha, porém, ela não tem uma imagem-assinatura: o Rio é essa imagem, e mostra o todo que a narrativa linear esconde. O Arquivo é o mais encantador para registros individuais, mas não sustenta uma tela inicial com milhares de linhas; seus quadros funcionam melhor como capítulo do que como protagonista.
        </p>
      </section>

      <section className="mt-20 max-w-[980px]">
        <h2 className="font-display text-[44px] leading-none">Necessidades da API identificadas</h2>
        <p className="mt-4 text-[18px] leading-[1.6]" style={{ color: "#3d3933" }}>
          Nada foi alterado no backend. Estas mudanças só seriam feitas com sua aprovação:
        </p>
        <ol className="mt-6 space-y-5 text-[18px] leading-[1.55]">
          <li>
            <strong>Demonstração já executada.</strong> Para abrir pelos resultados, um visitante novo precisa encontrar uma execução pronta. Hoje o relacionamento exige confirmação antes. Decisão de produto: confirmar automaticamente na demonstração (mantendo a evidência visível) ou manter o passo de confirmação antes dos resultados.
          </li>
          <li>
            <strong>Descrições de passos em linguagem simples.</strong> Os resumos atuais são técnicos (“refeicoes.cozinha_id = cozinhas.id”). Um rótulo opcional por passo na receita (“Ligar cada refeição à sua cozinha”) permitiria textos para leigos sem tirar a precisão.
          </li>
          <li>
            <strong>Fluxos de todos os resultados numa chamada</strong> (para o Rio): hoje são uma requisição por município, e grupos além de oito precisariam ser reunidos em “outros”.
          </li>
          <li>
            <strong>Destino de cada registro de uma entrada</strong> (para os quadros do Arquivo): hoje é montado a partir das contribuições de cada resultado e de todas as exclusões.
          </li>
        </ol>
      </section>
    </main>
  );
}
