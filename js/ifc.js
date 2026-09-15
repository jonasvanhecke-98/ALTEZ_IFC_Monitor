function normalizedTarget(target) {
  return String(target || '').trim();
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function psetRegex(target) {
  const name = regexEscape(normalizedTarget(target));

  if (!name) {
    return null;
  }

  return new RegExp(
    `IFCPROPERTYSET\\s*\\(\\s*[^,;]*,\\s*[^,;]*,\\s*'${name}'(?:\\s*,|\\s*\\))`,
    'i'
  );
}


/* =========================================================
   BRONSOFTWARE HERKENNEN
   ========================================================= */

function softwareFromText(text) {

  const source =
    String(text || '');

  const applicationStatements =
    (
      source.match(
        /IFCAPPLICATION\s*\([^;]{0,1500}\);?/gi
      ) || []
    ).join(' ');

  const fileNameStatement =
    (
      source.match(
        /FILE_NAME\s*\([^;]{0,2500}\);?/i
      ) || ['']
    )[0];


  /*
   * Eerst expliciete IFC producer-metadata gebruiken.
   * Zo vermijden we dat bijvoorbeeld "Revit" ergens toevallig
   * als gewone tekst in een Tekla-model staat.
   */

  const signal =
    `${applicationStatements} ${fileNameStatement}`
      .trim() ||
    source;

  const lower =
    signal.toLowerCase();


  const revitVersion =
    signal.match(
      /Autodesk\s+Revit(?:\s+IFC)?(?:\s+(20\d{2}))?/i
    ) ||
    signal.match(
      /Revit(?:\s+IFC)?(?:\s+(20\d{2}))?/i
    );


  /*
   * Tekla eerst controleren.
   */

  if (
    lower.includes('tekla structures') ||
    /\btekla\b/i.test(signal)
  ) {

    return {
      type: 'tekla',
      name: 'Tekla Structures',
      isRevit: false
    };

  }


  /*
   * Autodesk Revit.
   */

  if (
    /autodesk\s+revit|\brevit\b/i.test(signal)
  ) {

    const version =
      revitVersion?.[1] || '';

    return {

      type: 'revit',

      name:
        version
          ? `Autodesk Revit ${version}`
          : 'Autodesk Revit',

      isRevit: true

    };

  }


  /*
   * Andere gekende toepassingen.
   */

  if (
    lower.includes('archicad') ||
    lower.includes('graphisoft')
  ) {

    return {
      type: 'archicad',
      name: 'ARCHICAD',
      isRevit: false
    };

  }


  if (
    lower.includes('allplan')
  ) {

    return {
      type: 'allplan',
      name: 'Allplan',
      isRevit: false
    };

  }


  if (
    lower.includes('vectorworks')
  ) {

    return {
      type: 'vectorworks',
      name: 'Vectorworks',
      isRevit: false
    };

  }


  if (
    lower.includes('civil 3d') ||
    lower.includes('autodesk civil')
  ) {

    return {
      type: 'civil3d',
      name: 'Autodesk Civil 3D',
      isRevit: false
    };

  }


  if (
    lower.includes('navisworks')
  ) {

    return {
      type: 'navisworks',
      name: 'Autodesk Navisworks',
      isRevit: false
    };

  }


  if (
    lower.includes('rhino') ||
    lower.includes('rhinoceros')
  ) {

    return {
      type: 'rhino',
      name: 'Rhino',
      isRevit: false
    };

  }


  return {
    type: 'unknown',
    name: 'Onbekend',
    isRevit: false
  };

}


export function detectIfcSource(text) {

  return softwareFromText(text);

}


/* =========================================================
   BUFFER CONTROLES
   ========================================================= */

export function bufferContainsText(
  buffer,
  target
) {

  const needle =
    normalizedTarget(target)
      .toLowerCase();

  if (!needle) {
    return false;
  }

  const text =
    new TextDecoder('latin1')
      .decode(buffer)
      .toLowerCase();

  return text.includes(needle);

}


export function bufferContainsPset(
  buffer,
  target
) {

  const rx =
    psetRegex(target);

  if (!rx) {
    return false;
  }

  return rx.test(
    new TextDecoder('latin1')
      .decode(buffer)
  );

}


/* =========================================================
   VOLLEDIGE IFC INSPECTIE VAN BUFFER
   ========================================================= */

export function inspectIfcBuffer(
  buffer,
  target
) {

  const text =
    new TextDecoder('latin1')
      .decode(buffer);


  /*
   * Voor bronsoftware is de eerste 4 MB ruim voldoende.
   * IFCAPPLICATION en FILE_NAME staan normaal vooraan.
   */

  const source =
    softwareFromText(
      text.slice(
        0,
        4 * 1024 * 1024
      )
    );


  const rx =
    psetRegex(target);


  return {

    ...source,

    hasPset:
      rx
        ? rx.test(text)
        : false

  };

}


/* =========================================================
   OUDE PSET STREAM FUNCTIE
   ========================================================= */

export async function responseContainsPset(
  response,
  target
) {

  const rx =
    psetRegex(target);

  if (!rx) {
    return false;
  }


  if (
    !response.body?.getReader
  ) {

    return bufferContainsPset(
      await response.arrayBuffer(),
      target
    );

  }


  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder('latin1');

  let tail = '';

  const keep =
    8192;


  while (true) {

    const {
      done,
      value
    } =
      await reader.read();


    if (done) {
      break;
    }


    const chunk =
      tail +
      decoder.decode(
        value,
        {
          stream: true
        }
      );


    if (
      rx.test(chunk)
    ) {

      try {
        await reader.cancel();
      } catch {}

      return true;

    }


    tail =
      chunk.slice(-keep);

  }


  return rx.test(
    tail +
    decoder.decode()
  );

}


/* =========================================================
   STREAMING IFC INSPECTIE
   ========================================================= */

async function inspectIfcResponse(
  response,
  targetPset,
  mode = 'revit'
) {

  /*
   * mode:
   *
   * revit      = alleen Revit controleren
   * all        = alle IFC's controleren
   * non-revit  = alleen niet-Revit controleren
   */


  if (
    !response.body?.getReader
  ) {

    const inspected =
      inspectIfcBuffer(
        await response.arrayBuffer(),
        targetPset
      );


    const shouldCheck =

      mode === 'all' ||

      (
        mode === 'revit' &&
        inspected.isRevit
      ) ||

      (
        mode === 'non-revit' &&
        !inspected.isRevit
      );


    return {

      ...inspected,

      shouldCheck,

      skipped:
        !shouldCheck,

      hasPset:
        shouldCheck
          ? inspected.hasPset
          : null

    };

  }


  const rx =
    psetRegex(targetPset);


  const reader =
    response.body.getReader();


  const decoder =
    new TextDecoder('latin1');


  const keep =
    8192;


  /*
   * We lezen maximaal 4 MB om de bronsoftware te bepalen.
   */

  const sourceProbeLimit =
    4 * 1024 * 1024;


  let tail = '';

  let sourceProbe = '';

  let sourceInfo = {

    type: 'unknown',

    name: 'Onbekend',

    isRevit: false

  };


  let sourceResolved =
    false;


  let hasPset =
    false;


  let totalRead =
    0;


  while (true) {

    const {
      done,
      value
    } =
      await reader.read();


    if (done) {
      break;
    }


    totalRead +=
      value.byteLength;


    const decoded =
      decoder.decode(
        value,
        {
          stream: true
        }
      );


    /*
     * Bronsoftware zoeken.
     */

    if (
      sourceProbe.length <
      sourceProbeLimit
    ) {

      sourceProbe +=
        decoded;


      if (
        sourceProbe.length >
        sourceProbeLimit
      ) {

        sourceProbe =
          sourceProbe.slice(
            0,
            sourceProbeLimit
          );

      }


      const detected =
        softwareFromText(
          sourceProbe
        );


      if (
        detected.type !==
        'unknown'
      ) {

        sourceInfo =
          detected;

        sourceResolved =
          true;

      }

    }


    /*
     * Tegelijk Altez_IFC zoeken.
     */

    const chunk =
      tail +
      decoded;


    if (
      !hasPset &&
      rx &&
      rx.test(chunk)
    ) {

      hasPset =
        true;

    }


    tail =
      chunk.slice(-keep);


    /*
     * Bron gekend.
     *
     * Bij "Alleen Revit" kunnen we een Tekla/Archicad/etc.
     * onmiddellijk stoppen met downloaden.
     */

    if (
      sourceResolved
    ) {

      const shouldCheck =

        mode === 'all' ||

        (
          mode === 'revit' &&
          sourceInfo.isRevit
        ) ||

        (
          mode === 'non-revit' &&
          !sourceInfo.isRevit
        );


      if (
        !shouldCheck
      ) {

        try {
          await reader.cancel();
        } catch {}


        return {

          ...sourceInfo,

          hasPset:
            null,

          shouldCheck:
            false,

          skipped:
            true

        };

      }


      /*
       * Relevante IFC + propertyset gevonden:
       * verder lezen is niet nodig.
       */

      if (
        hasPset
      ) {

        try {
          await reader.cancel();
        } catch {}


        return {

          ...sourceInfo,

          hasPset:
            true,

          shouldCheck:
            true,

          skipped:
            false

        };

      }

    }


    /*
     * Na 4 MB nog geen producer gevonden.
     *
     * In Alleen Revit-modus behandelen we dit als onbekend
     * en dus als overgeslagen.
     */

    if (
      !sourceResolved &&
      totalRead >= sourceProbeLimit &&
      mode === 'revit'
    ) {

      try {
        await reader.cancel();
      } catch {}


      return {

        ...sourceInfo,

        hasPset:
          null,

        shouldCheck:
          false,

        skipped:
          true

      };

    }

  }


  const finalText =
    tail +
    decoder.decode();


  if (
    !hasPset &&
    rx
  ) {

    hasPset =
      rx.test(finalText);

  }


  if (
    !sourceResolved
  ) {

    sourceInfo =
      softwareFromText(
        sourceProbe
      );

  }


  const shouldCheck =

    mode === 'all' ||

    (
      mode === 'revit' &&
      sourceInfo.isRevit
    ) ||

    (
      mode === 'non-revit' &&
      !sourceInfo.isRevit
    );


  return {

    ...sourceInfo,

    hasPset:
      shouldCheck
        ? hasPset
        : null,

    shouldCheck,

    skipped:
      !shouldCheck

  };

}


/* =========================================================
   IFCZIP
   ========================================================= */

function findEocd(bytes) {

  const view =
    new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );


  const min =
    Math.max(
      0,
      bytes.byteLength -
      65557
    );


  for (
    let i =
      bytes.byteLength - 22;

    i >= min;

    i--
  ) {

    if (
      view.getUint32(
        i,
        true
      ) ===
      0x06054b50
    ) {

      return i;

    }

  }


  return -1;

}


async function inflateRaw(bytes) {

  if (
    typeof DecompressionStream !==
    'function'
  ) {

    throw new Error(
      'Deze browser ondersteunt IFCZIP-decompressie niet. Gebruik een recente Chrome/Edge-versie.'
    );

  }


  const stream =
    new Blob([bytes])
      .stream()
      .pipeThrough(
        new DecompressionStream(
          'deflate-raw'
        )
      );


  return new Uint8Array(
    await new Response(
      stream
    ).arrayBuffer()
  );

}


export async function extractIfcFromZip(
  arrayBuffer
) {

  const bytes =
    new Uint8Array(
      arrayBuffer
    );


  const view =
    new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );


  const eocd =
    findEocd(bytes);


  if (
    eocd < 0
  ) {

    throw new Error(
      'Ongeldig IFCZIP-bestand: ZIP-index niet gevonden.'
    );

  }


  const entryCount =
    view.getUint16(
      eocd + 10,
      true
    );


  let cursor =
    view.getUint32(
      eocd + 16,
      true
    );


  for (
    let n = 0;
    n < entryCount;
    n++
  ) {

    if (
      cursor + 46 >
        bytes.byteLength ||

      view.getUint32(
        cursor,
        true
      ) !==
        0x02014b50
    ) {

      throw new Error(
        'Ongeldig IFCZIP-bestand: central directory beschadigd.'
      );

    }


    const compression =
      view.getUint16(
        cursor + 10,
        true
      );


    const compressedSize =
      view.getUint32(
        cursor + 20,
        true
      );


    const fileNameLength =
      view.getUint16(
        cursor + 28,
        true
      );


    const extraLength =
      view.getUint16(
        cursor + 30,
        true
      );


    const commentLength =
      view.getUint16(
        cursor + 32,
        true
      );


    const localHeaderOffset =
      view.getUint32(
        cursor + 42,
        true
      );


    const fileName =
      new TextDecoder()
        .decode(
          bytes.slice(
            cursor + 46,
            cursor + 46 +
            fileNameLength
          )
        );


    if (
      fileName
        .toLowerCase()
        .endsWith('.ifc')
    ) {

      if (
        localHeaderOffset + 30 >
          bytes.byteLength ||

        view.getUint32(
          localHeaderOffset,
          true
        ) !==
          0x04034b50
      ) {

        throw new Error(
          'Ongeldig IFCZIP-bestand: local header ontbreekt.'
        );

      }


      const localNameLength =
        view.getUint16(
          localHeaderOffset + 26,
          true
        );


      const localExtraLength =
        view.getUint16(
          localHeaderOffset + 28,
          true
        );


      const dataStart =

        localHeaderOffset +

        30 +

        localNameLength +

        localExtraLength;


      const compressed =
        bytes.slice(
          dataStart,
          dataStart +
          compressedSize
        );


      if (
        compression === 0
      ) {

        return compressed;

      }


      if (
        compression === 8
      ) {

        return inflateRaw(
          compressed
        );

      }


      throw new Error(
        `IFCZIP compressiemethode ${compression} wordt niet ondersteund.`
      );

    }


    cursor +=

      46 +

      fileNameLength +

      extraLength +

      commentLength;

  }


  throw new Error(
    'IFCZIP bevat geen .ifc-bestand.'
  );

}


/* =========================================================
   HOOFDFUNCTIE
   ========================================================= */

export async function inspectIfcUrl(
  downloadUrl,
  fileName,
  targetPset,
  signal,
  options = {}
) {

  const mode =
    options.mode ||
    'revit';


  const response =
    await fetch(
      downloadUrl,
      {
        signal
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Download mislukt (${response.status} ${response.statusText}).`
    );

  }


  const lower =
    String(
      fileName || ''
    ).toLowerCase();


  /*
   * Gewone IFC.
   */

  if (
    lower.endsWith('.ifc')
  ) {

    return inspectIfcResponse(
      response,
      targetPset,
      mode
    );

  }


  /*
   * IFCZIP.
   */

  if (
    lower.endsWith('.ifczip')
  ) {

    const length =
      Number(
        response.headers.get(
          'content-length'
        ) || 0
      );


    if (
      length >
      300 * 1024 * 1024
    ) {

      throw new Error(
        'IFCZIP is groter dan 300 MB; dit bestand wordt overgeslagen om de browser stabiel te houden.'
      );

    }


    const ifcBytes =
      await extractIfcFromZip(
        await response.arrayBuffer()
      );


    const inspected =
      inspectIfcBuffer(
        ifcBytes,
        targetPset
      );


    const shouldCheck =

      mode === 'all' ||

      (
        mode === 'revit' &&
        inspected.isRevit
      ) ||

      (
        mode === 'non-revit' &&
        !inspected.isRevit
      );


    return {

      ...inspected,

      shouldCheck,

      skipped:
        !shouldCheck,

      hasPset:
        shouldCheck
          ? inspected.hasPset
          : null

    };

  }


  throw new Error(
    'Geen ondersteund IFC-bestand.'
  );

}


/* =========================================================
   BACKWARDS COMPATIBILITY
   ========================================================= */

export async function scanIfcUrl(
  downloadUrl,
  fileName,
  targetPset,
  signal
) {

  const result =
    await inspectIfcUrl(
      downloadUrl,
      fileName,
      targetPset,
      signal,
      {
        mode: 'all'
      }
    );


  return Boolean(
    result.hasPset
  );

}
