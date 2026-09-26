# Casa Principesca de Novgorod

Site estático em português, composto pela página inicial, três publicações e
uma cena panorâmica com controles de orientação.

## Executar

Sirva esta pasta por um servidor local (por exemplo, `python3 -m http.server`)
ou publique em HTTPS. Abra `index.html`. Geolocalização e sensores de movimento
dependem de contexto seguro (HTTPS ou `localhost`) e da permissão do usuário.

## Organização

- `index.html`: página inicial, controles e estrutura da cena.
- `blog0001.html`–`blog0003.html`: publicações.
- `style.css`: estilos compartilhados e responsividade.
- `scripts.js`: navegação, preferências visuais, efeitos e motor atmosférico.
- `skymap.js`: projeção e controles do panorama 360°×180°.
- `assets/`: imagens e texturas referenciadas pelas páginas e estilos.

O modo atmosférico inicia sempre em **Automático**. As condições atuais usam a
posição informada pela Geolocation API do navegador e a API Open-Meteo; os
dados meteorológicos são atualizados periodicamente (mínimo de 60 segundos
entre consultas). Sol e Lua são aproximações astronômicas calculadas no
aparelho a partir de hora e coordenadas. Se localização ou rede não estiverem
disponíveis, a cena usa céu limpo e informa o estado de sincronização; os modos
manuais seguem disponíveis até recarregar a página.

## Limites dos ativos atuais

`assets/cena-dia.png` e `assets/cena-noite.png` são imagens panorâmicas 2:1,
não geometria 3D. Elas permitem explorar o campo de visão horizontal completo
e inclinações dentro da imagem, mas não fornecem superfícies ou perspectivas
ocultas para uma volta vertical 360° real. Sol, Lua e estrelas dessas imagens
são pixels pré-renderizados; estrelas procedurais de reserva são decorativas,
sem catálogo astronômico ao vivo. O navegador fornece uma leitura de
geolocalização com precisão variável; as coordenadas enviadas ao provedor do
tempo não constituem uma segunda aferição independente da localização.

Para reconstruir o cenário completo em 3D e obter astronomia estelar precisa,
seriam necessários ativos 3D (malhas e texturas) e uma fonte/catálogo
astronômico apropriados.
