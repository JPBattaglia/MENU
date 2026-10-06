var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "../node_modules/qrcode/lib/can-promise.js"(exports, module) {
    module.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// ../node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "../node_modules/qrcode/lib/core/utils.js"(exports) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = /* @__PURE__ */ __name(function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    }, "getSymbolSize");
    exports.getSymbolTotalCodewords = /* @__PURE__ */ __name(function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    }, "getSymbolTotalCodewords");
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = /* @__PURE__ */ __name(function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    }, "setToSJISFunction");
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = /* @__PURE__ */ __name(function toSJIS(kanji) {
      return toSJISFunction(kanji);
    }, "toSJIS");
  }
});

// ../node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "../node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    __name(fromString, "fromString");
    exports.isValid = /* @__PURE__ */ __name(function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    }, "isValid");
    exports.from = /* @__PURE__ */ __name(function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    }, "from");
  }
});

// ../node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "../node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    __name(BitBuffer, "BitBuffer");
    BitBuffer.prototype = {
      get: /* @__PURE__ */ __name(function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      }, "get"),
      put: /* @__PURE__ */ __name(function(num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) === 1);
        }
      }, "put"),
      getLengthInBits: /* @__PURE__ */ __name(function() {
        return this.length;
      }, "getLengthInBits"),
      putBit: /* @__PURE__ */ __name(function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }, "putBit")
    };
    module.exports = BitBuffer;
  }
});

// ../node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "../node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    __name(BitMatrix, "BitMatrix");
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module.exports = BitMatrix;
  }
});

// ../node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "../node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = /* @__PURE__ */ __name(function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i = 1; i < posCount - 1; i++) {
        positions[i] = positions[i - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    }, "getRowColCoords");
    exports.getPositions = /* @__PURE__ */ __name(function getPositions(version) {
      const coords = [];
      const pos = exports.getRowColCoords(version);
      const posLength = pos.length;
      for (let i = 0; i < posLength; i++) {
        for (let j = 0; j < posLength; j++) {
          if (i === 0 && j === 0 || // top-left
          i === 0 && j === posLength - 1 || // bottom-left
          i === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i], pos[j]]);
        }
      }
      return coords;
    }, "getPositions");
  }
});

// ../node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "../node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = /* @__PURE__ */ __name(function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    }, "getPositions");
  }
});

// ../node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "../node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = /* @__PURE__ */ __name(function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    }, "isValid");
    exports.from = /* @__PURE__ */ __name(function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    }, "from");
    exports.getPenaltyN1 = /* @__PURE__ */ __name(function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module2 = data.get(row, col);
          if (module2 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module2;
            sameCountCol = 1;
          }
          module2 = data.get(col, row);
          if (module2 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module2;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    }, "getPenaltyN1");
    exports.getPenaltyN2 = /* @__PURE__ */ __name(function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    }, "getPenaltyN2");
    exports.getPenaltyN3 = /* @__PURE__ */ __name(function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    }, "getPenaltyN3");
    exports.getPenaltyN4 = /* @__PURE__ */ __name(function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    }, "getPenaltyN4");
    function getMaskAt(maskPattern, i, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    __name(getMaskAt, "getMaskAt");
    exports.applyMask = /* @__PURE__ */ __name(function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    }, "applyMask");
    exports.getBestMask = /* @__PURE__ */ __name(function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    }, "getBestMask");
  }
});

// ../node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "../node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = /* @__PURE__ */ __name(function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    }, "getBlocksCount");
    exports.getTotalCodewordsCount = /* @__PURE__ */ __name(function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    }, "getTotalCodewordsCount");
  }
});

// ../node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "../node_modules/qrcode/lib/core/galois-field.js"(exports) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (/* @__PURE__ */ __name(function initTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = x;
        LOG_TABLE[x] = i;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i = 255; i < 512; i++) {
        EXP_TABLE[i] = EXP_TABLE[i - 255];
      }
    }, "initTables"))();
    exports.log = /* @__PURE__ */ __name(function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    }, "log");
    exports.exp = /* @__PURE__ */ __name(function exp(n) {
      return EXP_TABLE[n];
    }, "exp");
    exports.mul = /* @__PURE__ */ __name(function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    }, "mul");
  }
});

// ../node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "../node_modules/qrcode/lib/core/polynomial.js"(exports) {
    var GF = require_galois_field();
    exports.mul = /* @__PURE__ */ __name(function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        }
      }
      return coeff;
    }, "mul");
    exports.mod = /* @__PURE__ */ __name(function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= GF.mul(divisor[i], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    }, "mod");
    exports.generateECPolynomial = /* @__PURE__ */ __name(function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
      }
      return poly;
    }, "generateECPolynomial");
  }
});

// ../node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "../node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    __name(ReedSolomonEncoder, "ReedSolomonEncoder");
    ReedSolomonEncoder.prototype.initialize = /* @__PURE__ */ __name(function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    }, "initialize");
    ReedSolomonEncoder.prototype.encode = /* @__PURE__ */ __name(function encode(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    }, "encode");
    module.exports = ReedSolomonEncoder;
  }
});

// ../node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "../node_modules/qrcode/lib/core/version-check.js"(exports) {
    exports.isValid = /* @__PURE__ */ __name(function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    }, "isValid");
  }
});

// ../node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "../node_modules/qrcode/lib/core/regex.js"(exports) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = /* @__PURE__ */ __name(function testKanji(str) {
      return TEST_KANJI.test(str);
    }, "testKanji");
    exports.testNumeric = /* @__PURE__ */ __name(function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    }, "testNumeric");
    exports.testAlphanumeric = /* @__PURE__ */ __name(function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    }, "testAlphanumeric");
  }
});

// ../node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "../node_modules/qrcode/lib/core/mode.js"(exports) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = /* @__PURE__ */ __name(function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    }, "getCharCountIndicator");
    exports.getBestModeForData = /* @__PURE__ */ __name(function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    }, "getBestModeForData");
    exports.toString = /* @__PURE__ */ __name(function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    }, "toString");
    exports.isValid = /* @__PURE__ */ __name(function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    }, "isValid");
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    __name(fromString, "fromString");
    exports.from = /* @__PURE__ */ __name(function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    }, "from");
  }
});

// ../node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "../node_modules/qrcode/lib/core/version.js"(exports) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    __name(getBestVersionForDataLength, "getBestVersionForDataLength");
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    __name(getReservedBitsCount, "getReservedBitsCount");
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    __name(getTotalBitsFromDataArray, "getTotalBitsFromDataArray");
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    __name(getBestVersionForMixedData, "getBestVersionForMixedData");
    exports.from = /* @__PURE__ */ __name(function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    }, "from");
    exports.getCapacity = /* @__PURE__ */ __name(function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    }, "getCapacity");
    exports.getBestVersionForData = /* @__PURE__ */ __name(function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    }, "getBestVersionForData");
    exports.getEncodedBits = /* @__PURE__ */ __name(function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    }, "getEncodedBits");
  }
});

// ../node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "../node_modules/qrcode/lib/core/format-info.js"(exports) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = /* @__PURE__ */ __name(function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    }, "getEncodedBits");
  }
});

// ../node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "../node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    __name(NumericData, "NumericData");
    NumericData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    }, "getBitsLength");
    NumericData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    NumericData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    }, "getBitsLength");
    NumericData.prototype.write = /* @__PURE__ */ __name(function write(bitBuffer) {
      let i, group, value;
      for (i = 0; i + 3 <= this.data.length; i += 3) {
        group = this.data.substr(i, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i;
      if (remainingNum > 0) {
        group = this.data.substr(i);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    }, "write");
    module.exports = NumericData;
  }
});

// ../node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "../node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    __name(AlphanumericData, "AlphanumericData");
    AlphanumericData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    }, "getBitsLength");
    AlphanumericData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    AlphanumericData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    }, "getBitsLength");
    AlphanumericData.prototype.write = /* @__PURE__ */ __name(function write(bitBuffer) {
      let i;
      for (i = 0; i + 2 <= this.data.length; i += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      }
    }, "write");
    module.exports = AlphanumericData;
  }
});

// ../node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "../node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    __name(ByteData, "ByteData");
    ByteData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return length * 8;
    }, "getBitsLength");
    ByteData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    ByteData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    }, "getBitsLength");
    ByteData.prototype.write = function(bitBuffer) {
      for (let i = 0, l = this.data.length; i < l; i++) {
        bitBuffer.put(this.data[i], 8);
      }
    };
    module.exports = ByteData;
  }
});

// ../node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "../node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    __name(KanjiData, "KanjiData");
    KanjiData.getBitsLength = /* @__PURE__ */ __name(function getBitsLength(length) {
      return length * 13;
    }, "getBitsLength");
    KanjiData.prototype.getLength = /* @__PURE__ */ __name(function getLength() {
      return this.data.length;
    }, "getLength");
    KanjiData.prototype.getBitsLength = /* @__PURE__ */ __name(function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    }, "getBitsLength");
    KanjiData.prototype.write = function(bitBuffer) {
      let i;
      for (i = 0; i < this.data.length; i++) {
        let value = Utils.toSJIS(this.data[i]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module.exports = KanjiData;
  }
});

// ../node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "../node_modules/dijkstrajs/dijkstra.js"(exports, module) {
    "use strict";
    var dijkstra = {
      single_source_shortest_paths: /* @__PURE__ */ __name(function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      }, "single_source_shortest_paths"),
      extract_shortest_path_from_predecessor_list: /* @__PURE__ */ __name(function(predecessors, d) {
        var nodes = [];
        var u = d;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      }, "extract_shortest_path_from_predecessor_list"),
      find_path: /* @__PURE__ */ __name(function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      }, "find_path"),
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: /* @__PURE__ */ __name(function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        }, "make"),
        default_sorter: /* @__PURE__ */ __name(function(a, b) {
          return a.cost - b.cost;
        }, "default_sorter"),
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: /* @__PURE__ */ __name(function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        }, "push"),
        /**
         * Return the highest priority element in the queue.
         */
        pop: /* @__PURE__ */ __name(function() {
          return this.queue.shift();
        }, "pop"),
        empty: /* @__PURE__ */ __name(function() {
          return this.queue.length === 0;
        }, "empty")
      }
    };
    if (typeof module !== "undefined") {
      module.exports = dijkstra;
    }
  }
});

// ../node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "../node_modules/qrcode/lib/core/segments.js"(exports) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    __name(getStringByteLength, "getStringByteLength");
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    __name(getSegments, "getSegments");
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    __name(getSegmentsFromString, "getSegmentsFromString");
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    __name(getSegmentBitsLength, "getSegmentBitsLength");
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    __name(mergeSegments, "mergeSegments");
    function buildNodes(segs) {
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    __name(buildNodes, "buildNodes");
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i = 0; i < nodes.length; i++) {
        const nodeGroup = nodes[i];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    __name(buildGraph, "buildGraph");
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    __name(buildSingleSegment, "buildSingleSegment");
    exports.fromArray = /* @__PURE__ */ __name(function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    }, "fromArray");
    exports.fromString = /* @__PURE__ */ __name(function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i = 1; i < path.length - 1; i++) {
        optimizedSegs.push(graph.table[path[i]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    }, "fromString");
    exports.rawSplit = /* @__PURE__ */ __name(function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    }, "rawSplit");
  }
});

// ../node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "../node_modules/qrcode/lib/core/qrcode.js"(exports) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    __name(setupFinderPattern, "setupFinderPattern");
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    __name(setupTimingPattern, "setupTimingPattern");
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    __name(setupAlignmentPattern, "setupAlignmentPattern");
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version);
      let row, col, mod;
      for (let i = 0; i < 18; i++) {
        row = Math.floor(i / 3);
        col = i % 3 + size - 8 - 3;
        mod = (bits >> i & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    __name(setupVersionInfo, "setupVersionInfo");
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i, mod;
      for (i = 0; i < 15; i++) {
        mod = (bits >> i & 1) === 1;
        if (i < 6) {
          matrix.set(i, 8, mod, true);
        } else if (i < 8) {
          matrix.set(i + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i, 8, mod, true);
        }
        if (i < 8) {
          matrix.set(8, size - i - 1, mod, true);
        } else if (i < 9) {
          matrix.set(8, 15 - i - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    __name(setupFormatInfo, "setupFormatInfo");
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    __name(setupData, "setupData");
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i = 0; i < remainingByte; i++) {
        buffer.put(i % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    __name(createData, "createData");
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i, r;
      for (i = 0; i < maxDataSize; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i < dcData[r].length) {
            data[index++] = dcData[r][i];
          }
        }
      }
      for (i = 0; i < ecCount; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i];
        }
      }
      return data;
    }
    __name(createCodewords, "createCodewords");
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    __name(createSymbol, "createSymbol");
    exports.create = /* @__PURE__ */ __name(function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    }, "create");
  }
});

// ../node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "../node_modules/qrcode/lib/renderer/utils.js"(exports) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    __name(hex2rgba, "hex2rgba");
    exports.getOptions = /* @__PURE__ */ __name(function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    }, "getOptions");
    exports.getScale = /* @__PURE__ */ __name(function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    }, "getScale");
    exports.getImageWidth = /* @__PURE__ */ __name(function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    }, "getImageWidth");
    exports.qrToImageData = /* @__PURE__ */ __name(function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i = 0; i < symbolSize; i++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    }, "qrToImageData");
  }
});

// ../node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "../node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    __name(clearCanvas, "clearCanvas");
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    __name(getCanvasElement, "getCanvasElement");
    exports.render = /* @__PURE__ */ __name(function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    }, "render");
    exports.renderToDataURL = /* @__PURE__ */ __name(function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    }, "renderToDataURL");
  }
});

// ../node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "../node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    __name(getColorAttrib, "getColorAttrib");
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    __name(svgCmd, "svgCmd");
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i = 0; i < data.length; i++) {
        const col = Math.floor(i % size);
        const row = Math.floor(i / size);
        if (!col && !newRow) newRow = true;
        if (data[i]) {
          lineLength++;
          if (!(i > 0 && col > 0 && data[i - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    __name(qrToPath, "qrToPath");
    exports.render = /* @__PURE__ */ __name(function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    }, "render");
  }
});

// ../node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "../node_modules/qrcode/lib/browser.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    __name(renderCanvas, "renderCanvas");
    exports.create = QRCode2.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// src/lib/http.js
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders()
      }
    }
  );
}
__name(jsonResponse, "jsonResponse");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function normalizeName(name) {
  return String(name || "").trim();
}
__name(normalizeName, "normalizeName");
function normalizeNullableText(value) {
  const clean = String(value || "").trim();
  return clean || null;
}
__name(normalizeNullableText, "normalizeNullableText");
function splitName(fullName) {
  const clean = normalizeName(fullName);
  if (!clean) {
    return {
      firstName: null,
      lastName: null
    };
  }
  const parts = clean.split(/\s+/);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: null
    };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}
__name(splitName, "splitName");
function safeFilename(filename) {
  const clean = String(filename || "upload").trim().replace(
    /[^a-zA-Z0-9._-]+/g,
    "-"
  ).replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "upload";
}
__name(safeFilename, "safeFilename");
function extensionForMime(mimeType) {
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg"
  };
  return map[mimeType] || "bin";
}
__name(extensionForMime, "extensionForMime");
function bytesToHex(bytes) {
  return Array.from(bytes).map(
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}
__name(bytesToHex, "bytesToHex");
function parseJsonOrNull(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
__name(parseJsonOrNull, "parseJsonOrNull");

// src/offers/catalog.js
async function getPublicOffers(env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    const timestamp = nowIso();
    const result = await env.DB.prepare(`
          SELECT
            o.id AS offer_id,
            o.code,
            o.name,
            o.category,
            o.public_slug,
            o.description,
            o.short_description,
            o.sort_order,
            o.is_featured,
            o.cta_text,
            o.display_badge,
            o.billing_type,
            o.fulfillment_type,
            o.requires_approval,
            o.requires_assets,
            o.default_workflow_key,

            v.id AS offer_version_id,
            v.version_number,
            v.price_cents,
            v.currency,
            v.billing_interval,
            v.setup_fee_cents,
            v.scope_json,
            v.exclusions_json,
            v.required_inputs_json,
            v.revision_limit,
            v.estimated_manual_minutes

          FROM offers o

          JOIN offer_versions v
            ON v.offer_id = o.id

          WHERE
            o.status = 'ACTIVE'
            AND o.is_public = 1
            AND v.status = 'ACTIVE'

            AND (
              v.effective_from IS NULL
              OR v.effective_from <= ?
            )

            AND (
              v.effective_to IS NULL
              OR v.effective_to > ?
            )

          ORDER BY
            o.sort_order ASC,
            o.name ASC,
            v.version_number DESC
        `).bind(
      timestamp,
      timestamp
    ).all();
    const seenOffers = /* @__PURE__ */ new Set();
    const offers = [];
    for (const row of result.results || []) {
      if (seenOffers.has(
        row.offer_id
      )) {
        continue;
      }
      seenOffers.add(
        row.offer_id
      );
      offers.push({
        id: row.offer_id,
        code: row.code,
        slug: row.public_slug,
        name: row.name,
        category: row.category,
        description: row.description,
        short_description: row.short_description,
        sort_order: Number(
          row.sort_order || 0
        ),
        featured: Boolean(
          row.is_featured
        ),
        cta_text: row.cta_text || "Get Started",
        display_badge: row.display_badge,
        billing_type: row.billing_type,
        fulfillment_type: row.fulfillment_type,
        requires_approval: Boolean(
          row.requires_approval
        ),
        requires_assets: Boolean(
          row.requires_assets
        ),
        workflow_key: row.default_workflow_key,
        current_version: {
          id: row.offer_version_id,
          version_number: Number(
            row.version_number
          ),
          price_cents: Number(
            row.price_cents
          ),
          currency: String(
            row.currency || "USD"
          ).toUpperCase(),
          billing_interval: row.billing_interval,
          setup_fee_cents: row.setup_fee_cents === null ? null : Number(
            row.setup_fee_cents
          ),
          scope: parseJsonOrNull(
            row.scope_json
          ),
          exclusions: parseJsonOrNull(
            row.exclusions_json
          ),
          required_inputs: parseJsonOrNull(
            row.required_inputs_json
          ),
          revision_limit: row.revision_limit === null ? null : Number(
            row.revision_limit
          ),
          estimated_manual_minutes: row.estimated_manual_minutes === null ? null : Number(
            row.estimated_manual_minutes
          )
        }
      });
    }
    return jsonResponse({
      ok: true,
      count: offers.length,
      offers
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(getPublicOffers, "getPublicOffers");
async function resolveActiveOffer(identifier, env, options = {}) {
  const clean = String(identifier || "").trim();
  if (!clean) {
    return null;
  }
  const requirePublic = options.requirePublic !== false;
  const timestamp = nowIso();
  const row = await env.DB.prepare(`
        SELECT
          o.id AS offer_id,
          o.code AS offer_code,
          o.name AS offer_name,
          o.category,
          o.public_slug,
          o.default_workflow_key,

          v.id AS offer_version_id,
          v.version_number,
          v.price_cents,
          v.currency,
          v.stripe_price_id,
          v.stripe_product_id

        FROM offers o

        JOIN offer_versions v
          ON v.offer_id = o.id

        WHERE
          o.status = 'ACTIVE'

          AND (
            ? = 0
            OR o.is_public = 1
          )

          AND v.status = 'ACTIVE'

          AND (
            v.effective_from IS NULL
            OR v.effective_from <= ?
          )

          AND (
            v.effective_to IS NULL
            OR v.effective_to > ?
          )

          AND (
            lower(o.id) = lower(?)
            OR lower(o.code) = lower(?)
            OR (
              o.public_slug IS NOT NULL
              AND lower(o.public_slug) =
                lower(?)
            )
          )

        ORDER BY
          v.version_number DESC

        LIMIT 1
      `).bind(
    requirePublic ? 1 : 0,
    timestamp,
    timestamp,
    clean,
    clean,
    clean
  ).first();
  return row || null;
}
__name(resolveActiveOffer, "resolveActiveOffer");

// src/lib/stripe-signature.js
async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parsed = parseStripeSignatureHeader(
    signatureHeader
  );
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    return false;
  }
  const toleranceSeconds = 300;
  const nowSeconds = Math.floor(
    Date.now() / 1e3
  );
  if (Math.abs(
    nowSeconds - parsed.timestamp
  ) > toleranceSeconds) {
    return false;
  }
  const signedPayload = `${parsed.timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );
  for (const signatureHex of parsed.signatures) {
    const signatureBytes = hexToBytes(signatureHex);
    if (!signatureBytes) {
      continue;
    }
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(
        signedPayload
      )
    );
    if (valid) {
      return true;
    }
  }
  return false;
}
__name(verifyStripeSignature, "verifyStripeSignature");
function parseStripeSignatureHeader(header) {
  const parts = header.split(",");
  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      timestamp = Number(value);
    }
    if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  return {
    timestamp,
    signatures
  };
}
__name(parseStripeSignatureHeader, "parseStripeSignatureHeader");
function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(
    hex.length / 2
  );
  for (let i = 0; i < hex.length; i += 2) {
    const value = Number.parseInt(
      hex.slice(i, i + 2),
      16
    );
    if (Number.isNaN(value)) {
      return null;
    }
    bytes[i / 2] = value;
  }
  return bytes;
}
__name(hexToBytes, "hexToBytes");

// src/tracking/funnel.js
async function recordFunnelEvent(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body"
        },
        400
      );
    }
    const allowedEvents = /* @__PURE__ */ new Set([
      "SITE_VISIT",
      "OFFER_VIEW",
      "CTA_CLICK",
      "CHECKOUT_STARTED",
      "PURCHASE_COMPLETED"
    ]);
    const eventType = String(
      data?.event_type || ""
    ).trim().toUpperCase();
    if (!allowedEvents.has(
      eventType
    )) {
      return jsonResponse(
        {
          ok: false,
          error: "Unsupported funnel event type"
        },
        400
      );
    }
    let offerId = normalizeNullableText(
      data?.offer_id
    );
    let offerVersionId = normalizeNullableText(
      data?.offer_version_id
    );
    const offerIdentifier = normalizeNullableText(
      data?.offer || data?.offer_code || data?.offer_slug
    );
    if (!offerId && offerIdentifier) {
      const offer = await resolveActiveOffer(
        offerIdentifier,
        env
      );
      if (!offer) {
        return jsonResponse(
          {
            ok: false,
            error: "Offer not found or not currently active"
          },
          404
        );
      }
      offerId = offer.offer_id;
      offerVersionId = offer.offer_version_id;
    }
    const eventId = crypto.randomUUID();
    await env.DB.prepare(`
        INSERT INTO funnel_events (
          id,
          created_at,
          event_type,
          visitor_id,
          session_id,
          offer_id,
          offer_version_id,
          order_id,
          source,
          medium,
          campaign,
          referrer,
          landing_path,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `).bind(
      eventId,
      nowIso(),
      eventType,
      normalizeNullableText(
        data?.visitor_id
      ),
      normalizeNullableText(
        data?.session_id
      ),
      offerId,
      offerVersionId,
      normalizeNullableText(
        data?.order_id
      ),
      normalizeNullableText(
        data?.source
      ),
      normalizeNullableText(
        data?.medium
      ),
      normalizeNullableText(
        data?.campaign
      ),
      normalizeNullableText(
        data?.referrer
      ),
      normalizeNullableText(
        data?.landing_path
      ),
      data?.metadata ? JSON.stringify(
        data.metadata
      ) : null
    ).run();
    return jsonResponse({
      ok: true,
      event_id: eventId,
      event_type: eventType
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(recordFunnelEvent, "recordFunnelEvent");
async function insertFunnelEvent(env, data) {
  if (!env.DB) {
    return;
  }
  await env.DB.prepare(`
      INSERT INTO funnel_events (
        id,
        created_at,
        event_type,
        visitor_id,
        session_id,
        offer_id,
        offer_version_id,
        order_id,
        source,
        medium,
        campaign,
        referrer,
        landing_path,
        metadata_json
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `).bind(
    crypto.randomUUID(),
    nowIso(),
    data.event_type,
    data.visitor_id || null,
    data.session_id || null,
    data.offer_id || null,
    data.offer_version_id || null,
    data.order_id || null,
    data.source || null,
    data.medium || null,
    data.campaign || null,
    data.referrer || null,
    data.landing_path || null,
    data.metadata ? JSON.stringify(
      data.metadata
    ) : null
  ).run();
}
__name(insertFunnelEvent, "insertFunnelEvent");

// src/lib/validation.js
function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
__name(isValidHttpUrl, "isValidHttpUrl");
function validateOnboardingValue(inputKey, inputType, value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return {
      valid: false,
      value: "",
      message: "This field is required."
    };
  }
  if (inputType === "URL" && !isValidHttpUrl(text)) {
    return {
      valid: false,
      value: text,
      message: "Enter a valid http:// or https:// URL."
    };
  }
  if (inputKey === "contact_email") {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(text)) {
      return {
        valid: false,
        value: text,
        message: "Enter a valid email address."
      };
    }
  }
  return {
    valid: true,
    value: text,
    message: null
  };
}
__name(validateOnboardingValue, "validateOnboardingValue");

// src/lib/email.js
var RESEND_ENDPOINT = "https://api.resend.com/emails";
var FROM_ADDRESS = "Menu-Made <orders@updates.menu-made.com>";
var REPLY_TO_ADDRESS = "info@menu-made.com";
var INTERNAL_BCC = "menu.automate@gmail.com";
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
__name(escapeHtml, "escapeHtml");
function formatCustomerName(firstName, lastName) {
  return [
    firstName,
    lastName
  ].filter(Boolean).join(" ").trim();
}
__name(formatCustomerName, "formatCustomerName");
function formatServiceNames(rows) {
  const names = (rows || []).map(
    (row) => String(
      row.offer_name || ""
    ).trim()
  ).filter(Boolean);
  if (names.length === 0) {
    return "Menu-Made service";
  }
  return names.join(", ");
}
__name(formatServiceNames, "formatServiceNames");
async function loadConfirmationContext(projectId, orderId, env) {
  const context = await env.DB.prepare(`
        SELECT
          p.id AS project_id,
          p.status AS project_status,
          p.project_type,
          p.workflow_key,
          p.workflow_version,

          o.id AS order_id,
          o.status AS order_status,
          o.payment_status,

          b.id AS business_id,
          b.name AS business_name,

          c.id AS customer_id,
          c.email AS customer_email,
          c.first_name,
          c.last_name

        FROM projects p

        JOIN orders o
          ON o.id =
            p.order_id

        JOIN businesses b
          ON b.id =
            p.business_id

        JOIN customers c
          ON c.id =
            p.customer_id

        WHERE
          p.id = ?
          AND o.id = ?

        LIMIT 1
      `).bind(
    projectId,
    orderId
  ).first();
  if (!context) {
    throw new Error(
      "Could not load onboarding email context"
    );
  }
  const serviceResult = await env.DB.prepare(`
        SELECT
          offers.name AS offer_name
        FROM order_items

        JOIN offers
          ON offers.id =
            order_items.offer_id

        WHERE
          order_items.order_id = ?

        ORDER BY
          offers.sort_order ASC,
          offers.name ASC
      `).bind(
    orderId
  ).all();
  return {
    ...context,
    serviceNames: formatServiceNames(
      serviceResult.results || []
    )
  };
}
__name(loadConfirmationContext, "loadConfirmationContext");
async function confirmationAlreadySent(projectId, env) {
  const existing = await env.DB.prepare(`
        SELECT id
        FROM business_events
        WHERE
          event_type =
            'ONBOARDING_CONFIRMATION_EMAIL_SENT'

          AND entity_type =
            'PROJECT'

          AND entity_id = ?

        LIMIT 1
      `).bind(
    projectId
  ).first();
  return Boolean(existing);
}
__name(confirmationAlreadySent, "confirmationAlreadySent");
async function logEmailEvent({
  eventType,
  projectId,
  orderId,
  customerId,
  payload
}, env) {
  await env.DB.prepare(`
      INSERT INTO business_events (
        id,
        created_at,
        event_type,
        entity_type,
        entity_id,
        actor_type,
        actor_id,
        correlation_id,
        payload_json
      )
      VALUES (
        ?,
        ?,
        ?,
        'PROJECT',
        ?,
        'SYSTEM',
        'MENU_MADE_EMAIL',
        ?,
        ?
      )
    `).bind(
    crypto.randomUUID(),
    nowIso(),
    eventType,
    projectId,
    orderId,
    JSON.stringify({
      customer_id: customerId,
      ...payload
    })
  ).run();
}
__name(logEmailEvent, "logEmailEvent");
function buildConfirmationEmail(context) {
  const customerName = formatCustomerName(
    context.first_name,
    context.last_name
  );
  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : "Hello,";
  const businessName = escapeHtml(
    context.business_name || "your business"
  );
  const orderId = escapeHtml(
    context.order_id
  );
  const services = escapeHtml(
    context.serviceNames
  );
  const subject = `Your Menu-Made project is ready for production`;
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${subject}</title>
</head>

<body style="
  margin:0;
  padding:0;
  background:#f4f7f8;
  font-family:Arial,Helvetica,sans-serif;
  color:#18313a;
">
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      width:100%;
      background:#f4f7f8;
      padding:32px 16px;
    "
  >
    <tr>
      <td align="center">

        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width:640px;
            background:#ffffff;
            border-radius:14px;
            overflow:hidden;
            box-shadow:
              0 8px 28px rgba(0,0,0,0.08);
          "
        >

          <tr>
            <td
              style="
                background:#003f52;
                padding:28px 32px;
                color:#ffffff;
              "
            >
              <div
                style="
                  font-size:25px;
                  font-weight:700;
                  letter-spacing:0.5px;
                "
              >
                MENU-MADE
              </div>

              <div
                style="
                  margin-top:7px;
                  color:#42d9eb;
                  font-size:14px;
                "
              >
                Digital tools for independent restaurants
              </div>
            </td>
          </tr>

          <tr>
            <td
              style="
                padding:36px 32px;
              "
            >
              <p
                style="
                  margin:0 0 22px;
                  font-size:16px;
                  line-height:1.6;
                "
              >
                ${greeting}
              </p>

              <h1
                style="
                  margin:0 0 18px;
                  color:#003f52;
                  font-size:26px;
                  line-height:1.25;
                "
              >
                Your project is ready for production.
              </h1>

              <p
                style="
                  margin:0 0 24px;
                  font-size:16px;
                  line-height:1.65;
                "
              >
                We received the required project information
                for <strong>${businessName}</strong>.
                Your Menu-Made project has now moved into
                the production workflow.
              </p>

              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  margin:0 0 26px;
                  background:#f1f8f9;
                  border:1px solid #d7eaed;
                  border-radius:10px;
                "
              >
                <tr>
                  <td
                    style="
                      padding:20px;
                      font-size:15px;
                      line-height:1.7;
                    "
                  >
                    <strong>Business:</strong>
                    ${businessName}
                    <br>

                    <strong>Service:</strong>
                    ${services}
                    <br>

                    <strong>Order reference:</strong>
                    ${orderId}
                  </td>
                </tr>
              </table>

              <p
                style="
                  margin:0 0 20px;
                  font-size:16px;
                  line-height:1.65;
                "
              >
                There is nothing else you need to submit
                right now. If we need clarification or
                additional access while your project is
                being completed, we will contact you.
              </p>

              <p
                style="
                  margin:0;
                  font-size:16px;
                  line-height:1.65;
                "
              >
                Thank you for choosing Menu-Made.
              </p>
            </td>
          </tr>

          <tr>
            <td
              style="
                background:#003f52;
                padding:24px 32px;
                text-align:center;
                color:#d8f3f6;
                font-size:13px;
                line-height:1.6;
              "
            >
              Menu-Made
              <br>
              menu-made.com
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
  const text = `
${customerName ? `Hi ${customerName},` : "Hello,"}

Your project is ready for production.

We received the required project information for ${context.business_name || "your business"}.

Business: ${context.business_name || "your business"}
Service: ${context.serviceNames}
Order reference: ${context.order_id}

Your Menu-Made project has now moved into the production workflow.

There is nothing else you need to submit right now. If we need clarification or additional access while your project is being completed, we will contact you.

Thank you for choosing Menu-Made.

Menu-Made
menu-made.com
  `.trim();
  return {
    subject,
    html,
    text
  };
}
__name(buildConfirmationEmail, "buildConfirmationEmail");
async function sendOnboardingConfirmationEmail({
  projectId,
  orderId
}, env) {
  if (!env.DB) {
    return {
      ok: false,
      skipped: true,
      error: "D1 binding DB is not available"
    };
  }
  if (!env.RESEND_API_KEY) {
    return {
      ok: false,
      skipped: true,
      error: "RESEND_API_KEY is not configured"
    };
  }
  const alreadySent = await confirmationAlreadySent(
    projectId,
    env
  );
  if (alreadySent) {
    return {
      ok: true,
      skipped: true,
      reason: "already_sent"
    };
  }
  const context = await loadConfirmationContext(
    projectId,
    orderId,
    env
  );
  const recipient = String(
    context.customer_email || ""
  ).trim();
  if (!recipient) {
    await logEmailEvent(
      {
        eventType: "ONBOARDING_CONFIRMATION_EMAIL_FAILED",
        projectId,
        orderId,
        customerId: context.customer_id,
        payload: {
          reason: "Customer email is missing"
        }
      },
      env
    );
    return {
      ok: false,
      skipped: true,
      error: "Customer email is missing"
    };
  }
  const email = buildConfirmationEmail(
    context
  );
  const idempotencyKey = `onboarding-ready/${projectId}`;
  let response;
  try {
    response = await fetch(
      RESEND_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [
            recipient
          ],
          bcc: [
            INTERNAL_BCC
          ],
          reply_to: REPLY_TO_ADDRESS,
          subject: email.subject,
          html: email.html,
          text: email.text
        })
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logEmailEvent(
      {
        eventType: "ONBOARDING_CONFIRMATION_EMAIL_FAILED",
        projectId,
        orderId,
        customerId: context.customer_id,
        payload: {
          recipient,
          error: message
        }
      },
      env
    );
    return {
      ok: false,
      error: message
    };
  }
  let responseData = null;
  try {
    responseData = await response.json();
  } catch {
    responseData = null;
  }
  if (!response.ok) {
    const message = responseData?.message || responseData?.error || `Resend returned HTTP ${response.status}`;
    await logEmailEvent(
      {
        eventType: "ONBOARDING_CONFIRMATION_EMAIL_FAILED",
        projectId,
        orderId,
        customerId: context.customer_id,
        payload: {
          recipient,
          status: response.status,
          error: message,
          response: responseData
        }
      },
      env
    );
    return {
      ok: false,
      status: response.status,
      error: message
    };
  }
  const resendEmailId = responseData?.id || null;
  await logEmailEvent(
    {
      eventType: "ONBOARDING_CONFIRMATION_EMAIL_SENT",
      projectId,
      orderId,
      customerId: context.customer_id,
      payload: {
        recipient,
        bcc: INTERNAL_BCC,
        from: FROM_ADDRESS,
        reply_to: REPLY_TO_ADDRESS,
        resend_email_id: resendEmailId,
        idempotency_key: idempotencyKey
      }
    },
    env
  );
  return {
    ok: true,
    email_id: resendEmailId
  };
}
__name(sendOnboardingConfirmationEmail, "sendOnboardingConfirmationEmail");

// src/workflows/definitions.js
async function loadWorkflowDefinition(workflowKey, workflowVersion, env) {
  if (!env.DB) {
    throw new Error(
      "D1 binding DB is not available"
    );
  }
  const cleanWorkflowKey = String(
    workflowKey || ""
  ).trim();
  const cleanWorkflowVersion = Number(
    workflowVersion
  );
  if (!cleanWorkflowKey) {
    throw new Error(
      "Workflow key is required"
    );
  }
  if (!Number.isInteger(
    cleanWorkflowVersion
  ) || cleanWorkflowVersion <= 0) {
    throw new Error(
      "Workflow version must be a positive integer"
    );
  }
  const definition = await env.DB.prepare(`
        SELECT
          id,
          workflow_key,
          version,
          status,
          steps_json
        FROM workflow_definitions
        WHERE
          workflow_key = ?
          AND version = ?
          AND status = 'ACTIVE'
        LIMIT 1
      `).bind(
    cleanWorkflowKey,
    cleanWorkflowVersion
  ).first();
  if (!definition) {
    throw new Error(
      `Active workflow definition not found for ${cleanWorkflowKey} v${cleanWorkflowVersion}`
    );
  }
  let parsedSteps;
  try {
    parsedSteps = JSON.parse(
      definition.steps_json
    );
  } catch {
    throw new Error(
      `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains invalid steps_json`
    );
  }
  if (!Array.isArray(
    parsedSteps
  ) || parsedSteps.length === 0) {
    throw new Error(
      `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} has no configured steps`
    );
  }
  const seenKeys = /* @__PURE__ */ new Set();
  const seenOrders = /* @__PURE__ */ new Set();
  const steps = parsedSteps.map(
    (step, index) => {
      const key = String(
        step?.key || ""
      ).trim();
      const order = Number(
        step?.order
      );
      if (!key) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains a step with no key at index ${index}`
        );
      }
      if (!Number.isInteger(order) || order < 0) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains an invalid step order for ${key}`
        );
      }
      if (seenKeys.has(key)) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains duplicate step key ${key}`
        );
      }
      if (seenOrders.has(order)) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains duplicate step order ${order}`
        );
      }
      seenKeys.add(key);
      seenOrders.add(order);
      return {
        key,
        order
      };
    }
  );
  steps.sort(
    (a, b) => a.order - b.order
  );
  return {
    id: definition.id,
    workflowKey: definition.workflow_key,
    workflowVersion: Number(
      definition.version
    ),
    steps
  };
}
__name(loadWorkflowDefinition, "loadWorkflowDefinition");
async function ensureProductionWorkflow(projectId, workflowKey, workflowVersion, customerId, orderId, env) {
  const definition = await loadWorkflowDefinition(
    workflowKey,
    workflowVersion,
    env
  );
  const existingRun = await env.DB.prepare(`
        SELECT
          id,
          status
        FROM workflow_runs
        WHERE project_id = ?
          AND workflow_key = ?
          AND workflow_version = ?
          AND trigger_type =
            'PROJECT_READY'
          AND trigger_reference = ?
        LIMIT 1
      `).bind(
    projectId,
    definition.workflowKey,
    definition.workflowVersion,
    projectId
  ).first();
  let workflowRunId = existingRun?.id || null;
  let created = false;
  if (!workflowRunId) {
    workflowRunId = crypto.randomUUID();
    const timestamp2 = nowIso();
    const insertResult = await env.DB.prepare(`
          INSERT OR IGNORE INTO workflow_runs (
            id,
            project_id,
            workflow_key,
            workflow_version,
            status,
            trigger_type,
            trigger_reference,
            attempt_number,
            created_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            'QUEUED',
            'PROJECT_READY',
            ?,
            1,
            ?
          )
        `).bind(
      workflowRunId,
      projectId,
      definition.workflowKey,
      definition.workflowVersion,
      projectId,
      timestamp2
    ).run();
    if (Number(
      insertResult.meta?.changes || 0
    ) > 0) {
      created = true;
    } else {
      const concurrentRun = await env.DB.prepare(`
            SELECT
              id,
              status
            FROM workflow_runs
            WHERE project_id = ?
              AND workflow_key = ?
              AND workflow_version = ?
              AND trigger_type =
                'PROJECT_READY'
              AND trigger_reference = ?
            LIMIT 1
          `).bind(
        projectId,
        definition.workflowKey,
        definition.workflowVersion,
        projectId
      ).first();
      workflowRunId = concurrentRun?.id || workflowRunId;
    }
  }
  const timestamp = nowIso();
  for (const step of definition.steps) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO workflow_steps (
          id,
          workflow_run_id,
          step_key,
          step_order,
          status,
          attempt_count,
          input_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          'QUEUED',
          0,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      workflowRunId,
      step.key,
      step.order,
      JSON.stringify({
        project_id: projectId,
        order_id: orderId,
        customer_id: customerId,
        workflow_key: definition.workflowKey,
        workflow_version: definition.workflowVersion,
        workflow_definition_id: definition.id,
        queued_at: timestamp
      })
    ).run();
  }
  if (created) {
    await env.DB.prepare(`
        INSERT INTO business_events (
          id,
          created_at,
          event_type,
          entity_type,
          entity_id,
          actor_type,
          actor_id,
          correlation_id,
          payload_json
        )
        VALUES (
          ?,
          ?,
          'PRODUCTION_WORKFLOW_QUEUED',
          'PROJECT',
          ?,
          'SYSTEM',
          'MENU_MADE_AUTOMATION',
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      timestamp,
      projectId,
      workflowRunId,
      JSON.stringify({
        order_id: orderId,
        workflow_key: definition.workflowKey,
        workflow_version: definition.workflowVersion,
        workflow_definition_id: definition.id
      })
    ).run();
  }
  return {
    id: workflowRunId,
    created,
    workflow_definition_id: definition.id
  };
}
__name(ensureProductionWorkflow, "ensureProductionWorkflow");

// src/onboarding/onboarding.js
async function verifyCheckoutAccess(orderId, sessionId, env) {
  if (!orderId || !sessionId) {
    return {
      ok: false,
      status: 400,
      error: "order_id and session_id are required"
    };
  }
  if (!env.DB) {
    return {
      ok: false,
      status: 500,
      error: "D1 binding DB is not available"
    };
  }
  const order = await env.DB.prepare(`
        SELECT
          id,
          customer_id,
          business_id,
          status,
          payment_status,
          stripe_checkout_session_id,
          stripe_payment_intent_id
        FROM orders
        WHERE id = ?
        LIMIT 1
      `).bind(orderId).first();
  if (!order) {
    return {
      ok: false,
      status: 404,
      error: "Order not found"
    };
  }
  if (!order.stripe_checkout_session_id) {
    return {
      ok: false,
      status: 403,
      error: "Order has no verified Checkout Session"
    };
  }
  if (order.stripe_checkout_session_id !== sessionId) {
    return {
      ok: false,
      status: 403,
      error: "Checkout Session does not match this order"
    };
  }
  if (order.payment_status !== "PAID") {
    return {
      ok: false,
      status: 403,
      error: "Order payment has not been verified"
    };
  }
  const environment = sessionId.startsWith("cs_test_") ? "sandbox" : "live";
  return {
    ok: true,
    order,
    environment
  };
}
__name(verifyCheckoutAccess, "verifyCheckoutAccess");
async function refreshOnboardingState(projectId, orderId, customerId, workflowKey, env) {
  const remainingResult = await env.DB.prepare(`
        SELECT
          input_key,
          input_type,
          status
        FROM project_inputs
        WHERE project_id = ?
          AND required = 1
          AND status <> 'VALID'
        ORDER BY input_key ASC
      `).bind(projectId).all();
  const remaining = remainingResult.results || [];
  const timestamp = nowIso();
  if (remaining.length === 0) {
    await env.DB.prepare(`
        UPDATE projects
        SET
          status = 'READY',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      projectId
    ).run();
    await env.DB.prepare(`
        UPDATE orders
        SET
          status =
            'READY_FOR_PRODUCTION',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      orderId
    ).run();
    const project = await env.DB.prepare(`
          SELECT
            workflow_version
          FROM projects
          WHERE id = ?
          LIMIT 1
        `).bind(projectId).first();
    const workflowVersion = Number(
      project?.workflow_version || 1
    );
    await ensureProductionWorkflow(
      projectId,
      workflowKey,
      workflowVersion,
      customerId,
      orderId,
      env
    );
    const existingEvent = await env.DB.prepare(`
          SELECT id
          FROM business_events
          WHERE event_type =
            'ONBOARDING_COMPLETED'
            AND entity_type =
              'PROJECT'
            AND entity_id = ?
          LIMIT 1
        `).bind(projectId).first();
    if (!existingEvent) {
      await env.DB.prepare(`
          INSERT INTO business_events (
            id,
            created_at,
            event_type,
            entity_type,
            entity_id,
            actor_type,
            actor_id,
            correlation_id,
            payload_json
          )
          VALUES (
            ?,
            ?,
            'ONBOARDING_COMPLETED',
            'PROJECT',
            ?,
            'CUSTOMER',
            ?,
            ?,
            ?
          )
        `).bind(
        crypto.randomUUID(),
        timestamp,
        projectId,
        customerId,
        orderId,
        JSON.stringify({
          workflow_key: workflowKey,
          workflow_version: workflowVersion
        })
      ).run();
    }
    try {
      await sendOnboardingConfirmationEmail(
        {
          projectId,
          orderId
        },
        env
      );
    } catch (emailError) {
      console.error(
        "Onboarding confirmation email failed:",
        emailError instanceof Error ? emailError.message : String(emailError)
      );
    }
  } else {
    await env.DB.prepare(`
        UPDATE projects
        SET
          status =
            'AWAITING_INPUTS',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      projectId
    ).run();
    await env.DB.prepare(`
        UPDATE orders
        SET
          status =
            'ONBOARDING_REQUIRED',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      orderId
    ).run();
  }
  return remaining;
}
__name(refreshOnboardingState, "refreshOnboardingState");
async function getOnboarding(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    const url = new URL(request.url);
    const orderId = url.searchParams.get(
      "order_id"
    );
    const sessionId = url.searchParams.get(
      "session_id"
    );
    const access = await verifyCheckoutAccess(
      orderId,
      sessionId,
      env
    );
    if (!access.ok) {
      return jsonResponse(
        {
          ok: false,
          error: access.error
        },
        access.status
      );
    }
    const project = await env.DB.prepare(`
          SELECT
            p.id,
            p.project_type,
            p.status,
            p.workflow_key,
            p.workflow_version,
            p.business_id,
            p.customer_id,
            b.name AS business_name,
            c.email AS customer_email,
            c.first_name,
            c.last_name
          FROM projects p
          JOIN businesses b
            ON b.id =
              p.business_id
          JOIN customers c
            ON c.id =
              p.customer_id
          WHERE p.order_id = ?
          ORDER BY
            p.created_at ASC
          LIMIT 1
        `).bind(orderId).first();
    if (!project) {
      return jsonResponse(
        {
          ok: false,
          error: "No onboarding project exists for this order"
        },
        404
      );
    }
    const inputs = await env.DB.prepare(`
          SELECT
            id,
            input_key,
            input_type,
            value_text,
            value_json,
            asset_id,
            required,
            status,
            validation_message,
            submitted_at,
            validated_at
          FROM project_inputs
          WHERE project_id = ?
          ORDER BY
            required DESC,
            input_key ASC
        `).bind(project.id).all();
    const rows = inputs.results || [];
    const missingRequired = rows.filter(
      (input) => Number(
        input.required
      ) === 1 && input.status !== "VALID"
    );
    return jsonResponse({
      ok: true,
      environment: access.environment,
      order: {
        id: access.order.id,
        status: access.order.status,
        payment_status: access.order.payment_status
      },
      project: {
        id: project.id,
        project_type: project.project_type,
        status: project.status,
        workflow_key: project.workflow_key,
        workflow_version: project.workflow_version
      },
      customer: {
        email: project.customer_email,
        name: [
          project.first_name,
          project.last_name
        ].filter(Boolean).join(" ")
      },
      business: {
        id: project.business_id,
        name: project.business_name
      },
      onboarding: {
        complete: missingRequired.length === 0,
        missing_required: missingRequired.map(
          (input) => input.input_key
        ),
        inputs: rows.map(
          (input) => ({
            key: input.input_key,
            type: input.input_type,
            required: Boolean(
              input.required
            ),
            status: input.status,
            value: input.value_text,
            asset_id: input.asset_id,
            validation_message: input.validation_message,
            file_upload_required: input.input_type === "FILE"
          })
        )
      }
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(getOnboarding, "getOnboarding");
async function saveOnboarding(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body"
        },
        400
      );
    }
    const orderId = String(
      data?.order_id || ""
    ).trim();
    const sessionId = String(
      data?.session_id || ""
    ).trim();
    const submittedFields = data?.fields && typeof data.fields === "object" && !Array.isArray(
      data.fields
    ) ? data.fields : {};
    const access = await verifyCheckoutAccess(
      orderId,
      sessionId,
      env
    );
    if (!access.ok) {
      return jsonResponse(
        {
          ok: false,
          error: access.error
        },
        access.status
      );
    }
    const project = await env.DB.prepare(`
          SELECT
            id,
            customer_id,
            status,
            workflow_key
          FROM projects
          WHERE order_id = ?
          ORDER BY
            created_at ASC
          LIMIT 1
        `).bind(orderId).first();
    if (!project) {
      return jsonResponse(
        {
          ok: false,
          error: "No onboarding project exists for this order"
        },
        404
      );
    }
    const inputRows = await env.DB.prepare(`
          SELECT
            id,
            input_key,
            input_type,
            required,
            status
          FROM project_inputs
          WHERE project_id = ?
        `).bind(project.id).all();
    const timestamp = nowIso();
    const results = [];
    for (const input of inputRows.results || []) {
      if (!Object.prototype.hasOwnProperty.call(
        submittedFields,
        input.input_key
      )) {
        continue;
      }
      if (input.input_type === "FILE") {
        results.push({
          key: input.input_key,
          saved: false,
          status: input.status,
          message: "This field requires a file upload."
        });
        continue;
      }
      const supplied = submittedFields[input.input_key];
      if (Number(
        input.required
      ) === 0 && String(
        supplied ?? ""
      ).trim() === "") {
        await env.DB.prepare(`
            UPDATE project_inputs
            SET
              value_text = NULL,
              status = 'MISSING',
              validation_message = NULL,
              submitted_at = NULL,
              validated_at = NULL,
              updated_at = ?
            WHERE id = ?
          `).bind(
          timestamp,
          input.id
        ).run();
        results.push({
          key: input.input_key,
          saved: true,
          status: "MISSING"
        });
        continue;
      }
      const validation = validateOnboardingValue(
        input.input_key,
        input.input_type,
        supplied
      );
      if (!validation.valid) {
        await env.DB.prepare(`
            UPDATE project_inputs
            SET
              value_text = ?,
              status = 'INVALID',
              validation_message = ?,
              submitted_at = ?,
              validated_at = NULL,
              updated_at = ?
            WHERE id = ?
          `).bind(
          validation.value,
          validation.message,
          timestamp,
          timestamp,
          input.id
        ).run();
        results.push({
          key: input.input_key,
          saved: false,
          status: "INVALID",
          message: validation.message
        });
        continue;
      }
      await env.DB.prepare(`
          UPDATE project_inputs
          SET
            value_text = ?,
            status = 'VALID',
            validation_message = NULL,
            submitted_at = ?,
            validated_at = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
        validation.value,
        timestamp,
        timestamp,
        timestamp,
        input.id
      ).run();
      results.push({
        key: input.input_key,
        saved: true,
        status: "VALID"
      });
    }
    const remaining = await refreshOnboardingState(
      project.id,
      orderId,
      project.customer_id,
      project.workflow_key,
      env
    );
    return jsonResponse({
      ok: true,
      environment: access.environment,
      project_id: project.id,
      saved: results,
      onboarding_complete: remaining.length === 0,
      remaining_required: remaining.map(
        (item) => ({
          key: item.input_key,
          type: item.input_type,
          status: item.status,
          file_upload_required: item.input_type === "FILE"
        })
      )
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(saveOnboarding, "saveOnboarding");
async function createMenuQrInputs(projectId, order, timestamp, env) {
  const business = await env.DB.prepare(`
        SELECT name
        FROM businesses
        WHERE id = ?
        LIMIT 1
      `).bind(
    order.business_id
  ).first();
  const customer = await env.DB.prepare(`
        SELECT email
        FROM customers
        WHERE id = ?
        LIMIT 1
      `).bind(
    order.customer_id
  ).first();
  const onboardingInputs = [
    {
      key: "business_name",
      type: "TEXT",
      required: 1,
      value: business?.name || null,
      status: business?.name ? "VALID" : "MISSING"
    },
    {
      key: "menu_source",
      type: "URL",
      required: 1,
      value: null,
      status: "MISSING"
    },
    {
      key: "logo",
      type: "FILE",
      required: 1,
      value: null,
      status: "MISSING"
    },
    {
      key: "brand_colors",
      type: "TEXT",
      required: 1,
      value: null,
      status: "MISSING"
    },
    {
      key: "qr_destination",
      type: "URL",
      required: 1,
      value: null,
      status: "MISSING"
    },
    {
      key: "contact_email",
      type: "TEXT",
      required: 1,
      value: customer?.email || null,
      status: customer?.email ? "VALID" : "MISSING"
    },
    {
      key: "menu_notes",
      type: "TEXT",
      required: 0,
      value: null,
      status: "MISSING"
    },
    {
      key: "special_instructions",
      type: "TEXT",
      required: 0,
      value: null,
      status: "MISSING"
    }
  ];
  for (const input of onboardingInputs) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO project_inputs (
          id,
          project_id,
          input_key,
          input_type,
          value_text,
          required,
          status,
          submitted_at,
          validated_at,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      projectId,
      input.key,
      input.type,
      input.value,
      input.required,
      input.status,
      input.status === "VALID" ? timestamp : null,
      input.status === "VALID" ? timestamp : null,
      timestamp,
      timestamp
    ).run();
  }
}
__name(createMenuQrInputs, "createMenuQrInputs");

// src/offers/checkout.js
async function normalizeCheckoutItems(itemsInput, env) {
  const normalizedItems = [];
  for (const item of itemsInput) {
    const identifier = item?.offer_id || item?.code || item?.slug || item?.key;
    if (!identifier) {
      continue;
    }
    const catalogRow = await resolveActiveOffer(
      identifier,
      env
    );
    if (!catalogRow) {
      continue;
    }
    const quantity = Number(item?.qty) > 0 ? Math.floor(
      Number(item.qty)
    ) : 1;
    normalizedItems.push({
      key: identifier,
      quantity,
      offerId: catalogRow.offer_id,
      offerCode: catalogRow.offer_code,
      offerName: catalogRow.offer_name,
      offerVersionId: catalogRow.offer_version_id,
      priceCents: Number(
        catalogRow.price_cents
      ),
      currency: String(
        catalogRow.currency || "USD"
      ).toUpperCase(),
      stripePriceId: catalogRow.stripe_price_id || null,
      stripeProductId: catalogRow.stripe_product_id || null
    });
  }
  return normalizedItems;
}
__name(normalizeCheckoutItems, "normalizeCheckoutItems");
async function createPendingOrder(data, normalizedItems, env, environment) {
  const customerInput = data?.customer || {};
  const email = normalizeEmail(
    customerInput.email || data.email
  );
  const name = normalizeName(
    customerInput.name || data.name
  );
  const businessName = normalizeName(
    customerInput.business || data.business
  );
  const phone = normalizeName(
    customerInput.phone || data.phone
  );
  const notes = normalizeName(
    customerInput.notes || data.notes
  );
  if (!email) {
    return {
      ok: false,
      status: 400,
      error: "Customer email is required"
    };
  }
  const timestamp = nowIso();
  const existingCustomer = await env.DB.prepare(`
        SELECT id
        FROM customers
        WHERE lower(email) =
          lower(?)
        LIMIT 1
      `).bind(email).first();
  let customerId;
  if (existingCustomer) {
    customerId = existingCustomer.id;
    const {
      firstName,
      lastName
    } = splitName(name);
    await env.DB.prepare(`
        UPDATE customers
        SET
          first_name =
            COALESCE(
              ?,
              first_name
            ),

          last_name =
            COALESCE(
              ?,
              last_name
            ),

          phone =
            COALESCE(
              ?,
              phone
            ),

          updated_at = ?

        WHERE id = ?
      `).bind(
      firstName,
      lastName,
      phone || null,
      timestamp,
      customerId
    ).run();
  } else {
    customerId = crypto.randomUUID();
    const {
      firstName,
      lastName
    } = splitName(name);
    await env.DB.prepare(`
        INSERT INTO customers (
          id,
          created_at,
          updated_at,
          email,
          first_name,
          last_name,
          phone,
          status,
          marketing_consent,
          lifetime_value_cents
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'ACTIVE',
          0,
          0
        )
      `).bind(
      customerId,
      timestamp,
      timestamp,
      email,
      firstName,
      lastName,
      phone || null
    ).run();
  }
  let businessId = null;
  if (businessName) {
    const existingBusiness = await env.DB.prepare(`
          SELECT id
          FROM businesses
          WHERE lower(name) =
            lower(?)
            AND business_status
              <> 'CLOSED'
          ORDER BY
            created_at ASC
          LIMIT 1
        `).bind(businessName).first();
    if (existingBusiness) {
      businessId = existingBusiness.id;
    } else {
      businessId = crypto.randomUUID();
      await env.DB.prepare(`
          INSERT INTO businesses (
            id,
            created_at,
            updated_at,
            name,
            phone,
            email,
            business_status,
            notes
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'ACTIVE_CUSTOMER',
            ?
          )
        `).bind(
        businessId,
        timestamp,
        timestamp,
        businessName,
        phone || null,
        email,
        notes || null
      ).run();
    }
    await env.DB.prepare(`
        INSERT OR IGNORE
        INTO customer_businesses (
          customer_id,
          business_id,
          role,
          is_primary,
          created_at
        )
        VALUES (
          ?,
          ?,
          'CUSTOMER',
          1,
          ?
        )
      `).bind(
      customerId,
      businessId,
      timestamp
    ).run();
  }
  const orderId = crypto.randomUUID();
  const subtotalCents = normalizedItems.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0
  );
  const currency = normalizedItems[0]?.currency || "USD";
  await env.DB.prepare(`
      INSERT INTO orders (
        id,
        created_at,
        updated_at,
        customer_id,
        business_id,
        status,
        currency,
        subtotal_cents,
        discount_cents,
        tax_cents,
        total_cents,
        payment_status,
        notes
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        'PAYMENT_PENDING',
        ?,
        ?,
        0,
        0,
        ?,
        'PENDING',
        ?
      )
    `).bind(
    orderId,
    timestamp,
    timestamp,
    customerId,
    businessId,
    currency,
    subtotalCents,
    subtotalCents,
    notes || null
  ).run();
  for (const item of normalizedItems) {
    await env.DB.prepare(`
        INSERT INTO order_items (
          id,
          order_id,
          offer_id,
          offer_version_id,
          quantity,
          unit_price_cents,
          line_total_cents,
          fulfillment_status,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'PENDING',
          ?
        )
      `).bind(
      crypto.randomUUID(),
      orderId,
      item.offerId,
      item.offerVersionId,
      item.quantity,
      item.priceCents,
      item.priceCents * item.quantity,
      JSON.stringify({
        offer_code: item.offerCode,
        environment
      })
    ).run();
  }
  return {
    ok: true,
    orderId,
    customerId,
    businessId,
    email,
    name,
    businessName,
    phone,
    notes
  };
}
__name(createPendingOrder, "createPendingOrder");
async function createCheckoutSessionTest(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    if (!env.STRIPE_SECRET_KEY_TEST) {
      return jsonResponse(
        {
          ok: false,
          error: "Stripe sandbox secret key is not configured"
        },
        500
      );
    }
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body"
        },
        400
      );
    }
    const itemsInput = Array.isArray(data?.items) ? data.items : [];
    const normalizedItems = await normalizeCheckoutItems(
      itemsInput,
      env
    );
    if (normalizedItems.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "No valid active public offers selected"
        },
        400
      );
    }
    const pending = await createPendingOrder(
      data,
      normalizedItems,
      env,
      "sandbox"
    );
    if (!pending.ok) {
      return jsonResponse(
        {
          ok: false,
          error: pending.error
        },
        pending.status
      );
    }
    const tracking = data?.tracking || {};
    const params = new URLSearchParams();
    params.append(
      "mode",
      "payment"
    );
    params.append(
      "success_url",
      `https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(pending.orderId)}`
    );
    params.append(
      "cancel_url",
      "https://menu-made.com/checkoutcancel.html"
    );
    params.append(
      "customer_email",
      pending.email
    );
    params.append(
      "metadata[order_id]",
      pending.orderId
    );
    params.append(
      "metadata[environment]",
      "sandbox"
    );
    params.append(
      "metadata[name]",
      pending.name
    );
    params.append(
      "metadata[business]",
      pending.businessName
    );
    params.append(
      "metadata[email]",
      pending.email
    );
    params.append(
      "metadata[phone]",
      pending.phone
    );
    params.append(
      "metadata[notes]",
      pending.notes
    );
    params.append(
      "metadata[services]",
      normalizedItems.map(
        (item) => item.offerName
      ).join(", ")
    );
    if (tracking.visitor_id) {
      params.append(
        "metadata[visitor_id]",
        String(
          tracking.visitor_id
        )
      );
    }
    if (tracking.session_id) {
      params.append(
        "metadata[visitor_session_id]",
        String(
          tracking.session_id
        )
      );
    }
    if (tracking.source) {
      params.append(
        "metadata[source]",
        String(
          tracking.source
        )
      );
    }
    if (tracking.medium) {
      params.append(
        "metadata[medium]",
        String(
          tracking.medium
        )
      );
    }
    if (tracking.campaign) {
      params.append(
        "metadata[campaign]",
        String(
          tracking.campaign
        )
      );
    }
    normalizedItems.forEach(
      (item, index) => {
        params.append(
          `line_items[${index}][price_data][currency]`,
          item.currency.toLowerCase()
        );
        params.append(
          `line_items[${index}][price_data][unit_amount]`,
          String(
            item.priceCents
          )
        );
        params.append(
          `line_items[${index}][price_data][product_data][name]`,
          item.offerName
        );
        params.append(
          `line_items[${index}][quantity]`,
          String(
            item.quantity
          )
        );
      }
    );
    const stripeRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY_TEST}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok || !stripeData.url) {
      await env.DB.prepare(`
          UPDATE orders
          SET
            status = 'FAILED',
            payment_status = 'FAILED',
            updated_at = ?
          WHERE id = ?
        `).bind(
        nowIso(),
        pending.orderId
      ).run();
      return jsonResponse(
        {
          ok: false,
          order_id: pending.orderId,
          stripe_error: stripeData
        },
        stripeRes.status || 500
      );
    }
    await env.DB.prepare(`
        UPDATE orders
        SET
          stripe_checkout_session_id = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
      stripeData.id,
      nowIso(),
      pending.orderId
    ).run();
    for (const item of normalizedItems) {
      await insertFunnelEvent(
        env,
        {
          event_type: "CHECKOUT_STARTED",
          visitor_id: normalizeNullableText(
            tracking.visitor_id
          ),
          session_id: normalizeNullableText(
            tracking.session_id
          ),
          offer_id: item.offerId,
          offer_version_id: item.offerVersionId,
          order_id: pending.orderId,
          source: normalizeNullableText(
            tracking.source
          ),
          medium: normalizeNullableText(
            tracking.medium
          ),
          campaign: normalizeNullableText(
            tracking.campaign
          ),
          referrer: normalizeNullableText(
            tracking.referrer
          ),
          landing_path: normalizeNullableText(
            tracking.landing_path
          ),
          metadata: {
            environment: "sandbox",
            stripe_checkout_session_id: stripeData.id
          }
        }
      );
    }
    return jsonResponse({
      ok: true,
      environment: "sandbox",
      order_id: pending.orderId,
      url: stripeData.url
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(createCheckoutSessionTest, "createCheckoutSessionTest");
async function createCheckoutSession(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    if (!env.STRIPE_SECRET_KEY) {
      return jsonResponse(
        {
          ok: false,
          error: "Stripe live secret key is not configured"
        },
        500
      );
    }
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body"
        },
        400
      );
    }
    const itemsInput = Array.isArray(data?.items) ? data.items : [];
    const normalizedItems = await normalizeCheckoutItems(
      itemsInput,
      env
    );
    if (normalizedItems.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "No valid active public offers selected"
        },
        400
      );
    }
    for (const item of normalizedItems) {
      if (!item.stripePriceId) {
        return jsonResponse(
          {
            ok: false,
            error: `No live Stripe price is configured for ${item.offerCode}`
          },
          500
        );
      }
    }
    const pending = await createPendingOrder(
      data,
      normalizedItems,
      env,
      "live"
    );
    if (!pending.ok) {
      return jsonResponse(
        {
          ok: false,
          error: pending.error
        },
        pending.status
      );
    }
    const tracking = data?.tracking || {};
    const params = new URLSearchParams();
    params.append(
      "mode",
      "payment"
    );
    params.append(
      "success_url",
      `https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(pending.orderId)}`
    );
    params.append(
      "cancel_url",
      "https://menu-made.com/checkoutcancel.html"
    );
    params.append(
      "customer_email",
      pending.email
    );
    params.append(
      "metadata[order_id]",
      pending.orderId
    );
    params.append(
      "metadata[environment]",
      "live"
    );
    params.append(
      "metadata[name]",
      pending.name
    );
    params.append(
      "metadata[business]",
      pending.businessName
    );
    params.append(
      "metadata[email]",
      pending.email
    );
    params.append(
      "metadata[phone]",
      pending.phone
    );
    params.append(
      "metadata[notes]",
      pending.notes
    );
    params.append(
      "metadata[services]",
      normalizedItems.map(
        (item) => item.offerName
      ).join(", ")
    );
    if (tracking.visitor_id) {
      params.append(
        "metadata[visitor_id]",
        String(
          tracking.visitor_id
        )
      );
    }
    if (tracking.session_id) {
      params.append(
        "metadata[visitor_session_id]",
        String(
          tracking.session_id
        )
      );
    }
    if (tracking.source) {
      params.append(
        "metadata[source]",
        String(
          tracking.source
        )
      );
    }
    if (tracking.medium) {
      params.append(
        "metadata[medium]",
        String(
          tracking.medium
        )
      );
    }
    if (tracking.campaign) {
      params.append(
        "metadata[campaign]",
        String(
          tracking.campaign
        )
      );
    }
    normalizedItems.forEach(
      (item, index) => {
        params.append(
          `line_items[${index}][price]`,
          item.stripePriceId
        );
        params.append(
          `line_items[${index}][quantity]`,
          String(
            item.quantity
          )
        );
      }
    );
    const stripeRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok || !stripeData.url) {
      await env.DB.prepare(`
          UPDATE orders
          SET
            status = 'FAILED',
            payment_status = 'FAILED',
            updated_at = ?
          WHERE id = ?
        `).bind(
        nowIso(),
        pending.orderId
      ).run();
      return jsonResponse(
        {
          ok: false,
          order_id: pending.orderId,
          stripe_error: stripeData
        },
        stripeRes.status || 500
      );
    }
    await env.DB.prepare(`
        UPDATE orders
        SET
          stripe_checkout_session_id = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
      stripeData.id,
      nowIso(),
      pending.orderId
    ).run();
    for (const item of normalizedItems) {
      await insertFunnelEvent(
        env,
        {
          event_type: "CHECKOUT_STARTED",
          visitor_id: normalizeNullableText(
            tracking.visitor_id
          ),
          session_id: normalizeNullableText(
            tracking.session_id
          ),
          offer_id: item.offerId,
          offer_version_id: item.offerVersionId,
          order_id: pending.orderId,
          source: normalizeNullableText(
            tracking.source
          ),
          medium: normalizeNullableText(
            tracking.medium
          ),
          campaign: normalizeNullableText(
            tracking.campaign
          ),
          referrer: normalizeNullableText(
            tracking.referrer
          ),
          landing_path: normalizeNullableText(
            tracking.landing_path
          ),
          metadata: {
            environment: "live",
            stripe_checkout_session_id: stripeData.id
          }
        }
      );
    }
    return jsonResponse({
      ok: true,
      environment: "live",
      order_id: pending.orderId,
      url: stripeData.url
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(createCheckoutSession, "createCheckoutSession");
async function handleStripeWebhook(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    const webhookSecrets = [];
    if (env.STRIPE_WEBHOOK_SECRET) {
      webhookSecrets.push({
        secret: env.STRIPE_WEBHOOK_SECRET,
        environment: "live"
      });
    }
    if (env.STRIPE_WEBHOOK_SECRET_TEST) {
      webhookSecrets.push({
        secret: env.STRIPE_WEBHOOK_SECRET_TEST,
        environment: "sandbox"
      });
    }
    if (webhookSecrets.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "No Stripe webhook secrets are configured"
        },
        500
      );
    }
    const signatureHeader = request.headers.get(
      "Stripe-Signature"
    );
    if (!signatureHeader) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing Stripe-Signature header"
        },
        400
      );
    }
    const rawBody = await request.text();
    let verifiedEnvironment = null;
    for (const candidate of webhookSecrets) {
      const valid = await verifyStripeSignature(
        rawBody,
        signatureHeader,
        candidate.secret
      );
      if (valid) {
        verifiedEnvironment = candidate.environment;
        break;
      }
    }
    if (!verifiedEnvironment) {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid Stripe signature"
        },
        400
      );
    }
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON payload"
        },
        400
      );
    }
    if (!event?.id || !event?.type) {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid Stripe event"
        },
        400
      );
    }
    const existingEvent = await env.DB.prepare(`
          SELECT
            id,
            status
          FROM provider_events
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
          LIMIT 1
        `).bind(event.id).first();
    if (existingEvent?.status === "PROCESSED") {
      return jsonResponse({
        ok: true,
        duplicate: true,
        event_id: event.id,
        environment: verifiedEnvironment
      });
    }
    const internalEventId = crypto.randomUUID();
    const receivedAt = nowIso();
    if (!existingEvent) {
      await env.DB.prepare(`
          INSERT INTO provider_events (
            id,
            provider,
            provider_event_id,
            event_type,
            received_at,
            status,
            attempt_count,
            payload_json
          )
          VALUES (
            ?,
            'STRIPE',
            ?,
            ?,
            ?,
            'RECEIVED',
            0,
            ?
          )
        `).bind(
        internalEventId,
        event.id,
        event.type,
        receivedAt,
        rawBody
      ).run();
    } else {
      await env.DB.prepare(`
          UPDATE provider_events
          SET
            event_type = ?,
            received_at = ?,
            status = 'RECEIVED',
            attempt_count =
              attempt_count + 1,
            last_error = NULL,
            payload_json = ?
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
        `).bind(
        event.type,
        receivedAt,
        rawBody,
        event.id
      ).run();
    }
    try {
      if (event.type === "checkout.session.completed") {
        await handleCheckoutCompleted(
          event,
          env
        );
      }
      await env.DB.prepare(`
          UPDATE provider_events
          SET
            status = 'PROCESSED',
            processed_at = ?,
            last_error = NULL
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
        `).bind(
        nowIso(),
        event.id
      ).run();
    } catch (processingError) {
      await env.DB.prepare(`
          UPDATE provider_events
          SET
            status = 'FAILED',
            last_error = ?
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
        `).bind(
        processingError instanceof Error ? processingError.message : String(
          processingError
        ),
        event.id
      ).run();
      throw processingError;
    }
    return jsonResponse({
      ok: true,
      event_id: event.id,
      event_type: event.type,
      environment: verifiedEnvironment
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(handleStripeWebhook, "handleStripeWebhook");
async function handleCheckoutCompleted(event, env) {
  const session = event?.data?.object;
  if (!session) {
    throw new Error(
      "checkout.session.completed event has no session object"
    );
  }
  const orderId = session?.metadata?.order_id || null;
  if (!orderId) {
    return;
  }
  const order = await env.DB.prepare(`
        SELECT
          id,
          customer_id,
          business_id,
          payment_status,
          status
        FROM orders
        WHERE id = ?
        LIMIT 1
      `).bind(orderId).first();
  if (!order) {
    throw new Error(
      `Stripe event references unknown order_id: ${orderId}`
    );
  }
  const timestamp = nowIso();
  await env.DB.prepare(`
      UPDATE orders
      SET
        payment_status = 'PAID',

        status = CASE
          WHEN status IN (
            'CREATED',
            'PAYMENT_PENDING'
          )
          THEN 'PAID'
          ELSE status
        END,

        stripe_checkout_session_id =
          COALESCE(
            stripe_checkout_session_id,
            ?
          ),

        stripe_payment_intent_id =
          COALESCE(
            stripe_payment_intent_id,
            ?
          ),

        placed_at =
          COALESCE(
            placed_at,
            ?
          ),

        updated_at = ?

      WHERE id = ?
    `).bind(
    session.id || null,
    session.payment_intent || null,
    timestamp,
    timestamp,
    orderId
  ).run();
  const providerPaymentId = session.payment_intent || session.id;
  if (providerPaymentId) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO payments (
          id,
          order_id,
          customer_id,
          provider,
          provider_payment_id,
          provider_checkout_session_id,
          status,
          amount_cents,
          currency,
          created_at,
          paid_at,
          provider_event_id,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          'STRIPE',
          ?,
          ?,
          'SUCCEEDED',
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      orderId,
      order.customer_id,
      providerPaymentId,
      session.id || null,
      Number(
        session.amount_total || 0
      ),
      String(
        session.currency || "usd"
      ).toUpperCase(),
      timestamp,
      timestamp,
      event.id,
      JSON.stringify({
        payment_status: session.payment_status || null,
        mode: session.mode || null
      })
    ).run();
  }
  await env.DB.prepare(`
      UPDATE customers
      SET
        last_purchase_at = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
    timestamp,
    timestamp,
    order.customer_id
  ).run();
  const purchasedItems = await env.DB.prepare(`
        SELECT
          offer_id,
          offer_version_id
        FROM order_items
        WHERE order_id = ?
      `).bind(orderId).all();
  for (const item of purchasedItems.results || []) {
    await insertFunnelEvent(
      env,
      {
        event_type: "PURCHASE_COMPLETED",
        visitor_id: session?.metadata?.visitor_id || null,
        session_id: session?.metadata?.visitor_session_id || null,
        offer_id: item.offer_id,
        offer_version_id: item.offer_version_id,
        order_id: orderId,
        source: session?.metadata?.source || null,
        medium: session?.metadata?.medium || null,
        campaign: session?.metadata?.campaign || null,
        metadata: {
          stripe_event_id: event.id,
          checkout_session_id: session.id || null,
          amount_total: Number(
            session.amount_total || 0
          ),
          currency: String(
            session.currency || "usd"
          ).toUpperCase()
        }
      }
    );
  }
  if (order.business_id) {
    const orderItems = await env.DB.prepare(`
          SELECT
            oi.id AS order_item_id,
            o.category,
            o.default_workflow_key
          FROM order_items oi
          JOIN offers o
            ON o.id =
              oi.offer_id
          WHERE oi.order_id = ?
        `).bind(orderId).all();
    for (const item of orderItems.results || []) {
      const existingProject = await env.DB.prepare(`
            SELECT id
            FROM projects
            WHERE order_item_id = ?
            LIMIT 1
          `).bind(
        item.order_item_id
      ).first();
      if (existingProject) {
        continue;
      }
      const projectId = crypto.randomUUID();
      await env.DB.prepare(`
          INSERT INTO projects (
            id,
            order_id,
            order_item_id,
            business_id,
            customer_id,
            project_type,
            status,
            workflow_key,
            workflow_version,
            priority,
            manual_review_required,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'AWAITING_INPUTS',
            ?,
            1,
            'NORMAL',
            0,
            ?,
            ?
          )
        `).bind(
        projectId,
        orderId,
        item.order_item_id,
        order.business_id,
        order.customer_id,
        item.category,
        item.default_workflow_key,
        timestamp,
        timestamp
      ).run();
      if (item.default_workflow_key === "MENU_QR_V1") {
        await createMenuQrInputs(
          projectId,
          order,
          timestamp,
          env
        );
      }
    }
  }
  await env.DB.prepare(`
      UPDATE orders
      SET
        status =
          'ONBOARDING_REQUIRED',
        updated_at = ?
      WHERE id = ?
    `).bind(
    timestamp,
    orderId
  ).run();
  const existingAudit = await env.DB.prepare(`
        SELECT id
        FROM business_events
        WHERE event_type =
          'ORDER_PAID_ONBOARDING_STARTED'
          AND entity_type =
            'ORDER'
          AND entity_id = ?
          AND correlation_id = ?
        LIMIT 1
      `).bind(
    orderId,
    event.id
  ).first();
  if (!existingAudit) {
    await env.DB.prepare(`
        INSERT INTO business_events (
          id,
          created_at,
          event_type,
          entity_type,
          entity_id,
          actor_type,
          actor_id,
          correlation_id,
          payload_json
        )
        VALUES (
          ?,
          ?,
          'ORDER_PAID_ONBOARDING_STARTED',
          'ORDER',
          ?,
          'PROVIDER',
          'STRIPE',
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      timestamp,
      orderId,
      event.id,
      JSON.stringify({
        checkout_session_id: session.id || null
      })
    ).run();
  }
}
__name(handleCheckoutCompleted, "handleCheckoutCompleted");

// src/onboarding/uploads.js
async function uploadOnboardingAsset(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    if (!env.ASSETS) {
      return jsonResponse(
        {
          ok: false,
          error: "R2 ASSETS binding is not available"
        },
        500
      );
    }
    const contentType = request.headers.get(
      "Content-Type"
    ) || "";
    if (!contentType.toLowerCase().includes(
      "multipart/form-data"
    )) {
      return jsonResponse(
        {
          ok: false,
          error: "Upload must use multipart/form-data"
        },
        400
      );
    }
    const form = await request.formData();
    const orderId = String(
      form.get("order_id") || ""
    ).trim();
    const sessionId = String(
      form.get("session_id") || ""
    ).trim();
    const inputKey = String(
      form.get("input_key") || "logo"
    ).trim();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return jsonResponse(
        {
          ok: false,
          error: "A file is required"
        },
        400
      );
    }
    const access = await verifyCheckoutAccess(
      orderId,
      sessionId,
      env
    );
    if (!access.ok) {
      return jsonResponse(
        {
          ok: false,
          error: access.error
        },
        access.status
      );
    }
    const project = await env.DB.prepare(`
          SELECT
            id,
            customer_id,
            business_id,
            workflow_key
          FROM projects
          WHERE order_id = ?
          ORDER BY
            created_at ASC
          LIMIT 1
        `).bind(orderId).first();
    if (!project) {
      return jsonResponse(
        {
          ok: false,
          error: "No onboarding project exists for this order"
        },
        404
      );
    }
    const input = await env.DB.prepare(`
          SELECT
            id,
            input_key,
            input_type,
            asset_id,
            required,
            status
          FROM project_inputs
          WHERE project_id = ?
            AND input_key = ?
          LIMIT 1
        `).bind(
      project.id,
      inputKey
    ).first();
    if (!input) {
      return jsonResponse(
        {
          ok: false,
          error: "Onboarding file field not found"
        },
        404
      );
    }
    if (input.input_type !== "FILE") {
      return jsonResponse(
        {
          ok: false,
          error: "This onboarding field is not a file field"
        },
        400
      );
    }
    if (input.input_key !== "logo") {
      return jsonResponse(
        {
          ok: false,
          error: "Unsupported upload field"
        },
        400
      );
    }
    const allowedMimeTypes = /* @__PURE__ */ new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/svg+xml"
    ]);
    const mimeType = String(
      file.type || ""
    ).toLowerCase();
    if (!allowedMimeTypes.has(
      mimeType
    )) {
      return jsonResponse(
        {
          ok: false,
          error: "Logo must be PNG, JPEG, WebP, or SVG"
        },
        400
      );
    }
    const maxBytes = 10 * 1024 * 1024;
    if (Number(file.size) <= 0) {
      return jsonResponse(
        {
          ok: false,
          error: "Uploaded file is empty"
        },
        400
      );
    }
    if (Number(file.size) > maxBytes) {
      return jsonResponse(
        {
          ok: false,
          error: "Logo must be 10 MB or smaller"
        },
        413
      );
    }
    const arrayBuffer = await file.arrayBuffer();
    const checksumBuffer = await crypto.subtle.digest(
      "SHA-256",
      arrayBuffer
    );
    const checksum = bytesToHex(
      new Uint8Array(
        checksumBuffer
      )
    );
    const assetId = crypto.randomUUID();
    const extension = extensionForMime(
      mimeType
    );
    const originalFilename = safeFilename(
      file.name || `logo.${extension}`
    );
    const storageKey = [
      "customers",
      project.customer_id,
      "projects",
      project.id,
      "logo",
      `${assetId}.${extension}`
    ].join("/");
    const timestamp = nowIso();
    await env.ASSETS.put(
      storageKey,
      arrayBuffer,
      {
        httpMetadata: {
          contentType: mimeType
        },
        customMetadata: {
          assetId,
          projectId: project.id,
          orderId,
          customerId: project.customer_id,
          businessId: project.business_id || "",
          inputKey: input.input_key,
          originalFilename
        }
      }
    );
    try {
      await env.DB.prepare(`
          INSERT INTO assets (
            id,
            business_id,
            customer_id,
            project_id,
            asset_type,
            storage_provider,
            storage_key,
            original_filename,
            mime_type,
            size_bytes,
            checksum,
            status,
            uploaded_at,
            validated_at,
            approved_for_use,
            is_customer_supplied,
            rights_confirmed,
            metadata_json
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            'LOGO',
            'R2',
            ?,
            ?,
            ?,
            ?,
            ?,
            'VALID',
            ?,
            ?,
            1,
            1,
            1,
            ?
          )
        `).bind(
        assetId,
        project.business_id || null,
        project.customer_id,
        project.id,
        storageKey,
        originalFilename,
        mimeType,
        Number(file.size),
        checksum,
        timestamp,
        timestamp,
        JSON.stringify({
          input_key: input.input_key,
          environment: access.environment
        })
      ).run();
      await env.DB.prepare(`
          UPDATE project_inputs
          SET
            asset_id = ?,
            value_text = NULL,
            status = 'VALID',
            validation_message = NULL,
            submitted_at = ?,
            validated_at = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
        assetId,
        timestamp,
        timestamp,
        timestamp,
        input.id
      ).run();
    } catch (dbError) {
      await env.ASSETS.delete(
        storageKey
      );
      throw dbError;
    }
    if (input.asset_id && input.asset_id !== assetId) {
      const oldAsset = await env.DB.prepare(`
            SELECT
              id,
              storage_key
            FROM assets
            WHERE id = ?
            LIMIT 1
          `).bind(
        input.asset_id
      ).first();
      if (oldAsset) {
        await env.DB.prepare(`
            UPDATE assets
            SET
              status = 'ARCHIVED',
              approved_for_use = 0
            WHERE id = ?
          `).bind(
          oldAsset.id
        ).run();
        if (oldAsset.storage_key) {
          await env.ASSETS.delete(
            oldAsset.storage_key
          );
        }
      }
    }
    const remaining = await refreshOnboardingState(
      project.id,
      orderId,
      project.customer_id,
      project.workflow_key,
      env
    );
    return jsonResponse({
      ok: true,
      environment: access.environment,
      project_id: project.id,
      input_key: input.input_key,
      asset: {
        id: assetId,
        asset_type: "LOGO",
        original_filename: originalFilename,
        mime_type: mimeType,
        size_bytes: Number(file.size),
        checksum,
        status: "VALID"
      },
      onboarding_complete: remaining.length === 0,
      remaining_required: remaining.map(
        (item) => ({
          key: item.input_key,
          type: item.input_type,
          status: item.status
        })
      )
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(uploadOnboardingAsset, "uploadOnboardingAsset");

// src/workflows/runner.js
var import_qrcode = __toESM(require_browser());
function verifyProductionRunner(request, env) {
  if (!env.PRODUCTION_RUNNER_SECRET) {
    return {
      ok: false,
      status: 500,
      error: "Production runner secret is not configured"
    };
  }
  const authorization = request.headers.get(
    "Authorization"
  ) || "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(
    prefix
  )) {
    return {
      ok: false,
      status: 401,
      error: "Production runner authorization is required"
    };
  }
  const suppliedSecret = authorization.slice(prefix.length).trim();
  if (suppliedSecret !== env.PRODUCTION_RUNNER_SECRET) {
    return {
      ok: false,
      status: 403,
      error: "Invalid production runner authorization"
    };
  }
  return {
    ok: true
  };
}
__name(verifyProductionRunner, "verifyProductionRunner");
function bytesToHex2(bytes) {
  return Array.from(bytes).map(
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}
__name(bytesToHex2, "bytesToHex");
async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(
    String(value)
  );
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );
  return bytesToHex2(
    new Uint8Array(buffer)
  );
}
__name(sha256Hex, "sha256Hex");
function escapeHtml2(value) {
  return String(
    value ?? ""
  ).replaceAll(
    "&",
    "&amp;"
  ).replaceAll(
    "<",
    "&lt;"
  ).replaceAll(
    ">",
    "&gt;"
  ).replaceAll(
    '"',
    "&quot;"
  ).replaceAll(
    "'",
    "&#039;"
  );
}
__name(escapeHtml2, "escapeHtml");
function sanitizeFilename(value) {
  const clean = String(
    value || "menu"
  ).trim().toLowerCase().replace(
    /[^a-z0-9]+/g,
    "-"
  ).replace(
    /^-+|-+$/g,
    ""
  );
  return clean || "menu";
}
__name(sanitizeFilename, "sanitizeFilename");
function extractReadableText(html) {
  return String(
    html || ""
  ).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    " "
  ).replace(
    /<style\b[^>]*>[\s\S]*?<\/style>/gi,
    " "
  ).replace(
    /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
    " "
  ).replace(
    /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
    " "
  ).replace(
    /<br\s*\/?>/gi,
    "\n"
  ).replace(
    /<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|tr)>/gi,
    "\n"
  ).replace(
    /<[^>]+>/g,
    " "
  ).replaceAll(
    "&nbsp;",
    " "
  ).replaceAll(
    "&amp;",
    "&"
  ).replaceAll(
    "&quot;",
    '"'
  ).replaceAll(
    "&#39;",
    "'"
  ).replaceAll(
    "&lt;",
    "<"
  ).replaceAll(
    "&gt;",
    ">"
  ).replace(
    /\r/g,
    ""
  ).replace(
    /[ \t]+/g,
    " "
  ).replace(
    /\n[ \t]+/g,
    "\n"
  ).replace(
    /\n{3,}/g,
    "\n\n"
  ).trim();
}
__name(extractReadableText, "extractReadableText");
function getInputValue(inputs, key) {
  const input = inputs?.[key];
  if (!input) {
    return null;
  }
  if (input.type === "FILE") {
    return input.asset || null;
  }
  return input.value ?? null;
}
__name(getInputValue, "getInputValue");
async function prepareProjectInputs(projectId, env) {
  const result = await env.DB.prepare(`
        SELECT
          pi.id AS project_input_id,
          pi.input_key,
          pi.input_type,
          pi.value_text,
          pi.value_json,
          pi.asset_id,
          pi.required,
          pi.status,

          a.id AS resolved_asset_id,
          a.asset_type,
          a.storage_provider,
          a.storage_key,
          a.original_filename,
          a.mime_type,
          a.size_bytes,
          a.checksum,
          a.status AS asset_status,
          a.approved_for_use,
          a.rights_confirmed

        FROM project_inputs pi

        LEFT JOIN assets a
          ON a.id =
            pi.asset_id

        WHERE
          pi.project_id = ?

        ORDER BY
          pi.required DESC,
          pi.input_key ASC
      `).bind(projectId).all();
  const rows = result.results || [];
  const invalidRequired = rows.filter(
    (row) => Number(row.required) === 1 && row.status !== "VALID"
  );
  if (invalidRequired.length > 0) {
    return {
      ok: false,
      error: "Required project inputs are not valid",
      missing_or_invalid: invalidRequired.map(
        (row) => ({
          key: row.input_key,
          status: row.status
        })
      )
    };
  }
  const preparedInputs = {};
  for (const row of rows) {
    if (row.status !== "VALID") {
      continue;
    }
    if (row.input_type === "FILE") {
      if (!row.resolved_asset_id) {
        return {
          ok: false,
          error: `Validated file input ${row.input_key} has no asset`
        };
      }
      if (row.asset_status !== "VALID") {
        return {
          ok: false,
          error: `Asset for ${row.input_key} is not valid`
        };
      }
      preparedInputs[row.input_key] = {
        type: "FILE",
        asset: {
          id: row.resolved_asset_id,
          asset_type: row.asset_type,
          storage_provider: row.storage_provider,
          storage_key: row.storage_key,
          original_filename: row.original_filename,
          mime_type: row.mime_type,
          size_bytes: Number(
            row.size_bytes || 0
          ),
          checksum: row.checksum,
          approved_for_use: Boolean(
            row.approved_for_use
          ),
          rights_confirmed: row.rights_confirmed === null ? null : Boolean(
            row.rights_confirmed
          )
        }
      };
      continue;
    }
    if (row.input_type === "JSON") {
      preparedInputs[row.input_key] = {
        type: "JSON",
        value: parseJsonOrNull(
          row.value_json
        )
      };
      continue;
    }
    preparedInputs[row.input_key] = {
      type: row.input_type,
      value: row.value_text
    };
  }
  return {
    ok: true,
    inputs: preparedInputs
  };
}
__name(prepareProjectInputs, "prepareProjectInputs");
async function loadProject(projectId, env) {
  return env.DB.prepare(`
      SELECT
        p.id,
        p.order_id,
        p.order_item_id,
        p.business_id,
        p.customer_id,
        p.project_type,
        p.workflow_key,
        p.workflow_version,

        b.name AS business_name,

        c.email AS customer_email,
        c.first_name,
        c.last_name

      FROM projects p

      JOIN businesses b
        ON b.id =
          p.business_id

      JOIN customers c
        ON c.id =
          p.customer_id

      WHERE
        p.id = ?

      LIMIT 1
    `).bind(projectId).first();
}
__name(loadProject, "loadProject");
async function completeStep(targetStep, output, env) {
  const completedAt = nowIso();
  await env.DB.prepare(`
      UPDATE workflow_steps
      SET
        status = 'SUCCEEDED',
        completed_at = ?,
        output_json = ?,
        error_message = NULL
      WHERE id = ?
    `).bind(
    completedAt,
    JSON.stringify(output),
    targetStep.workflow_step_id
  ).run();
  await env.DB.prepare(`
      INSERT INTO business_events (
        id,
        created_at,
        event_type,
        entity_type,
        entity_id,
        actor_type,
        actor_id,
        correlation_id,
        payload_json
      )
      VALUES (
        ?,
        ?,
        'PRODUCTION_STEP_COMPLETED',
        'PROJECT',
        ?,
        'SYSTEM',
        'MENU_MADE_AUTOMATION',
        ?,
        ?
      )
    `).bind(
    crypto.randomUUID(),
    completedAt,
    targetStep.project_id,
    targetStep.workflow_run_id,
    JSON.stringify({
      workflow_run_id: targetStep.workflow_run_id,
      workflow_step_id: targetStep.workflow_step_id,
      workflow_key: targetStep.workflow_key,
      workflow_version: Number(
        targetStep.workflow_version
      ),
      step_key: targetStep.step_key
    })
  ).run();
  return completedAt;
}
__name(completeStep, "completeStep");
async function findNextStep(targetStep, env) {
  return env.DB.prepare(`
      SELECT
        id,
        step_key,
        step_order,
        status
      FROM workflow_steps
      WHERE
        workflow_run_id = ?
        AND step_order > ?
        AND status = 'QUEUED'
      ORDER BY
        step_order ASC
      LIMIT 1
    `).bind(
    targetStep.workflow_run_id,
    targetStep.step_order
  ).first();
}
__name(findNextStep, "findNextStep");
async function runPrepareInputsStep(targetStep, env) {
  const prepared = await prepareProjectInputs(
    targetStep.project_id,
    env
  );
  if (!prepared.ok) {
    const waitingTimestamp = nowIso();
    await env.DB.prepare(`
        UPDATE workflow_steps
        SET
          status = 'WAITING',
          error_message = ?,
          output_json = ?
        WHERE id = ?
      `).bind(
      prepared.error,
      JSON.stringify({
        ok: false,
        error: prepared.error,
        missing_or_invalid: prepared.missing_or_invalid || []
      }),
      targetStep.workflow_step_id
    ).run();
    await env.DB.prepare(`
        UPDATE workflow_runs
        SET
          status = 'WAITING',
          error_code =
            'INPUTS_NOT_READY',
          error_message = ?
        WHERE id = ?
      `).bind(
      prepared.error,
      targetStep.workflow_run_id
    ).run();
    await env.DB.prepare(`
        UPDATE projects
        SET
          status = 'BLOCKED',
          blocked_reason = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
      prepared.error,
      waitingTimestamp,
      targetStep.project_id
    ).run();
    return {
      waiting: true,
      response: jsonResponse(
        {
          ok: false,
          processed: true,
          workflow_run_id: targetStep.workflow_run_id,
          workflow_step_id: targetStep.workflow_step_id,
          step_key: targetStep.step_key,
          status: "WAITING",
          error: prepared.error,
          missing_or_invalid: prepared.missing_or_invalid || []
        },
        409
      )
    };
  }
  const project = await loadProject(
    targetStep.project_id,
    env
  );
  if (!project) {
    throw new Error(
      "Production project could not be loaded"
    );
  }
  const preparedPayload = {
    prepared_at: nowIso(),
    project: {
      id: project.id,
      order_id: project.order_id,
      order_item_id: project.order_item_id,
      project_type: project.project_type,
      workflow_key: project.workflow_key,
      workflow_version: Number(
        project.workflow_version
      )
    },
    business: {
      id: project.business_id,
      name: project.business_name
    },
    customer: {
      id: project.customer_id,
      email: project.customer_email,
      name: [
        project.first_name,
        project.last_name
      ].filter(Boolean).join(" ")
    },
    inputs: prepared.inputs
  };
  await completeStep(
    targetStep,
    preparedPayload,
    env
  );
  return {
    waiting: false,
    output: preparedPayload
  };
}
__name(runPrepareInputsStep, "runPrepareInputsStep");
async function loadPreparedPayload(targetStep, env) {
  const previousStep = await env.DB.prepare(`
        SELECT
          output_json
        FROM workflow_steps
        WHERE
          workflow_run_id = ?
          AND step_key =
            'PREPARE_INPUTS'
          AND status =
            'SUCCEEDED'
        ORDER BY
          step_order ASC
        LIMIT 1
      `).bind(
    targetStep.workflow_run_id
  ).first();
  if (!previousStep?.output_json) {
    throw new Error(
      "PREPARE_INPUTS output is not available"
    );
  }
  const payload = parseJsonOrNull(
    previousStep.output_json
  );
  if (!payload || !payload.inputs) {
    throw new Error(
      "PREPARE_INPUTS output is invalid"
    );
  }
  return payload;
}
__name(loadPreparedPayload, "loadPreparedPayload");
async function fetchMenuSource(menuSource) {
  let sourceUrl;
  try {
    sourceUrl = new URL(
      menuSource
    );
  } catch {
    throw new Error(
      "menu_source is not a valid URL"
    );
  }
  if (sourceUrl.protocol !== "https:" && sourceUrl.protocol !== "http:") {
    throw new Error(
      "menu_source must use HTTP or HTTPS"
    );
  }
  const response = await fetch(
    sourceUrl.toString(),
    {
      headers: {
        "User-Agent": "Menu-Made-Automation/1.0",
        "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.5"
      },
      redirect: "follow"
    }
  );
  if (!response.ok) {
    throw new Error(
      `Menu source returned HTTP ${response.status}`
    );
  }
  const contentType = (response.headers.get(
    "content-type"
  ) || "").split(";")[0].trim().toLowerCase();
  if (contentType === "application/pdf" || contentType.startsWith(
    "image/"
  )) {
    throw new Error(
      `Menu source format ${contentType} requires document extraction before GENERATE_MENU_DRAFT can process it`
    );
  }
  const allowed = contentType === "text/html" || contentType === "text/plain" || contentType === "application/json" || contentType.endsWith(
    "+json"
  );
  if (!allowed) {
    throw new Error(
      `Unsupported menu source content type: ${contentType || "unknown"}`
    );
  }
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(
      "Menu source returned no readable content"
    );
  }
  let readableText;
  if (contentType === "text/html") {
    readableText = extractReadableText(
      raw
    );
  } else if (contentType === "application/json" || contentType.endsWith(
    "+json"
  )) {
    try {
      readableText = JSON.stringify(
        JSON.parse(raw),
        null,
        2
      );
    } catch {
      readableText = raw.trim();
    }
  } else {
    readableText = raw.trim();
  }
  if (!readableText) {
    throw new Error(
      "Menu source contained no readable menu text"
    );
  }
  return {
    requested_url: menuSource,
    resolved_url: response.url || menuSource,
    content_type: contentType,
    text: readableText
  };
}
__name(fetchMenuSource, "fetchMenuSource");
function buildMenuDraftHtml({
  businessName,
  brandColors,
  sourceUrl,
  menuText
}) {
  const safeBusiness = escapeHtml2(
    businessName
  );
  const safeColors = escapeHtml2(
    brandColors || ""
  );
  const safeSource = escapeHtml2(
    sourceUrl
  );
  const safeMenu = escapeHtml2(
    menuText
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeBusiness} Menu</title>
  <style>
    :root {
      color-scheme: light;
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #f7f7f5;
      color: #171717;
      line-height: 1.6;
    }

    main {
      width: min(900px, calc(100% - 32px));
      margin: 0 auto;
      padding: 48px 0 72px;
    }

    header {
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid #d8d8d4;
    }

    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 6vw, 4rem);
      line-height: 1;
    }

    .brand-colors {
      margin: 0;
      color: #666;
    }

    .menu-content {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 1rem;
    }

    footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid #d8d8d4;
      font-size: 0.8rem;
      color: #666;
    }

    footer a {
      color: inherit;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${safeBusiness}</h1>
      <p>Menu</p>
      ${safeColors ? `<p class="brand-colors">Brand colors supplied: ${safeColors}</p>` : ""}
    </header>

    <section
      class="menu-content"
      aria-label="${safeBusiness} menu"
    >${safeMenu}</section>

    <footer>
      <p>
        Draft generated from
        <a href="${safeSource}">
          supplied menu source
        </a>.
      </p>
    </footer>
  </main>
</body>
</html>`;
}
__name(buildMenuDraftHtml, "buildMenuDraftHtml");
async function runGenerateMenuDraftStep(targetStep, env) {
  if (!env.ASSETS) {
    throw new Error(
      "R2 ASSETS binding is not available"
    );
  }
  const preparedPayload = await loadPreparedPayload(
    targetStep,
    env
  );
  const project = await loadProject(
    targetStep.project_id,
    env
  );
  if (!project) {
    throw new Error(
      "Production project could not be loaded"
    );
  }
  const menuSource = getInputValue(
    preparedPayload.inputs,
    "menu_source"
  );
  if (!menuSource) {
    throw new Error(
      "menu_source is required to generate the menu draft"
    );
  }
  const businessName = getInputValue(
    preparedPayload.inputs,
    "business_name"
  ) || project.business_name;
  const brandColors = getInputValue(
    preparedPayload.inputs,
    "brand_colors"
  );
  const source = await fetchMenuSource(
    menuSource
  );
  const draftHtml = buildMenuDraftHtml({
    businessName,
    brandColors,
    sourceUrl: source.resolved_url,
    menuText: source.text
  });
  const encodedDraft = new TextEncoder().encode(
    draftHtml
  );
  const checksum = await sha256Hex(
    encodedDraft
  );
  const existingDeliverable = await env.DB.prepare(`
        SELECT
          d.id AS deliverable_id,
          d.asset_id,
          d.version,
          a.storage_key,
          a.original_filename,
          a.mime_type,
          a.size_bytes,
          a.checksum
        FROM deliverables d
        JOIN assets a
          ON a.id =
            d.asset_id
        WHERE
          d.project_id = ?
          AND d.deliverable_type =
            'MENU_DRAFT'
          AND d.version = 1
        LIMIT 1
      `).bind(
    project.id
  ).first();
  if (existingDeliverable) {
    const output2 = {
      generated_at: nowIso(),
      reused_existing: true,
      source: {
        requested_url: source.requested_url,
        resolved_url: source.resolved_url,
        content_type: source.content_type
      },
      asset: {
        id: existingDeliverable.asset_id,
        storage_provider: "R2",
        storage_key: existingDeliverable.storage_key,
        original_filename: existingDeliverable.original_filename,
        mime_type: existingDeliverable.mime_type,
        size_bytes: Number(
          existingDeliverable.size_bytes || 0
        ),
        checksum: existingDeliverable.checksum
      },
      deliverable: {
        id: existingDeliverable.deliverable_id,
        type: "MENU_DRAFT",
        version: Number(
          existingDeliverable.version
        ),
        status: "DRAFT"
      }
    };
    await completeStep(
      targetStep,
      output2,
      env
    );
    return output2;
  }
  const assetId = crypto.randomUUID();
  const deliverableId = crypto.randomUUID();
  const filenameBase = sanitizeFilename(
    businessName
  );
  const originalFilename = `${filenameBase}-menu-draft-v1.html`;
  const storageKey = [
    "customers",
    project.customer_id,
    "projects",
    project.id,
    "deliverables",
    "menu-draft",
    "v1",
    `${assetId}.html`
  ].join("/");
  const timestamp = nowIso();
  await env.ASSETS.put(
    storageKey,
    encodedDraft,
    {
      httpMetadata: {
        contentType: "text/html; charset=utf-8"
      },
      customMetadata: {
        assetId,
        projectId: project.id,
        orderId: project.order_id,
        customerId: project.customer_id,
        businessId: project.business_id || "",
        deliverableType: "MENU_DRAFT",
        version: "1",
        originalFilename
      }
    }
  );
  let assetInserted = false;
  try {
    await env.DB.prepare(`
        INSERT INTO assets (
          id,
          business_id,
          customer_id,
          project_id,
          asset_type,
          storage_provider,
          storage_key,
          original_filename,
          mime_type,
          size_bytes,
          checksum,
          status,
          uploaded_at,
          validated_at,
          approved_for_use,
          is_customer_supplied,
          rights_confirmed,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          'DELIVERABLE',
          'R2',
          ?,
          ?,
          'text/html',
          ?,
          ?,
          'VALID',
          ?,
          ?,
          1,
          0,
          1,
          ?
        )
      `).bind(
      assetId,
      project.business_id || null,
      project.customer_id,
      project.id,
      storageKey,
      originalFilename,
      encodedDraft.byteLength,
      checksum,
      timestamp,
      timestamp,
      JSON.stringify({
        generated_by: "MENU_MADE_AUTOMATION",
        workflow_run_id: targetStep.workflow_run_id,
        workflow_step_id: targetStep.workflow_step_id,
        workflow_key: targetStep.workflow_key,
        workflow_version: Number(
          targetStep.workflow_version
        ),
        source_url: source.resolved_url,
        source_content_type: source.content_type,
        deliverable_type: "MENU_DRAFT",
        deliverable_version: 1
      })
    ).run();
    assetInserted = true;
    await env.DB.prepare(`
        INSERT INTO deliverables (
          id,
          project_id,
          asset_id,
          deliverable_type,
          version,
          status,
          customer_visible,
          created_at
        )
        VALUES (
          ?,
          ?,
          ?,
          'MENU_DRAFT',
          1,
          'DRAFT',
          0,
          ?
        )
      `).bind(
      deliverableId,
      project.id,
      assetId,
      timestamp
    ).run();
  } catch (error) {
    if (assetInserted) {
      try {
        await env.DB.prepare(`
            DELETE FROM assets
            WHERE id = ?
          `).bind(assetId).run();
      } catch {
      }
    }
    try {
      await env.ASSETS.delete(
        storageKey
      );
    } catch {
    }
    throw error;
  }
  const output = {
    generated_at: timestamp,
    reused_existing: false,
    source: {
      requested_url: source.requested_url,
      resolved_url: source.resolved_url,
      content_type: source.content_type
    },
    asset: {
      id: assetId,
      storage_provider: "R2",
      storage_key: storageKey,
      original_filename: originalFilename,
      mime_type: "text/html",
      size_bytes: encodedDraft.byteLength,
      checksum
    },
    deliverable: {
      id: deliverableId,
      type: "MENU_DRAFT",
      version: 1,
      status: "DRAFT",
      customer_visible: false
    }
  };
  await completeStep(
    targetStep,
    output,
    env
  );
  return output;
}
__name(runGenerateMenuDraftStep, "runGenerateMenuDraftStep");
async function runGenerateQrStep(targetStep, env) {
  if (!env.ASSETS) {
    throw new Error(
      "R2 ASSETS binding is not available"
    );
  }
  const preparedPayload = await loadPreparedPayload(
    targetStep,
    env
  );
  const project = await loadProject(
    targetStep.project_id,
    env
  );
  if (!project) {
    throw new Error(
      "Production project could not be loaded"
    );
  }
  const qrDestination = getInputValue(
    preparedPayload.inputs,
    "qr_destination"
  );
  if (!qrDestination) {
    throw new Error(
      "qr_destination is required to generate the QR code"
    );
  }
  let destinationUrl;
  try {
    destinationUrl = new URL(
      qrDestination
    );
  } catch {
    throw new Error(
      "qr_destination is not a valid URL"
    );
  }
  if (destinationUrl.protocol !== "https:" && destinationUrl.protocol !== "http:") {
    throw new Error(
      "qr_destination must use HTTP or HTTPS"
    );
  }
  const existingDeliverable = await env.DB.prepare(`
        SELECT
          d.id AS deliverable_id,
          d.asset_id,
          d.version,
          a.storage_key,
          a.original_filename,
          a.mime_type,
          a.size_bytes,
          a.checksum
        FROM deliverables d
        JOIN assets a
          ON a.id =
            d.asset_id
        WHERE
          d.project_id = ?
          AND d.deliverable_type =
            'QR_CODE'
          AND d.version = 1
        LIMIT 1
      `).bind(
    project.id
  ).first();
  if (existingDeliverable) {
    const output2 = {
      generated_at: nowIso(),
      reused_existing: true,
      destination_url: destinationUrl.toString(),
      asset: {
        id: existingDeliverable.asset_id,
        storage_provider: "R2",
        storage_key: existingDeliverable.storage_key,
        original_filename: existingDeliverable.original_filename,
        mime_type: existingDeliverable.mime_type,
        size_bytes: Number(
          existingDeliverable.size_bytes || 0
        ),
        checksum: existingDeliverable.checksum
      },
      deliverable: {
        id: existingDeliverable.deliverable_id,
        type: "QR_CODE",
        version: Number(
          existingDeliverable.version
        ),
        status: "DRAFT"
      }
    };
    await completeStep(
      targetStep,
      output2,
      env
    );
    return output2;
  }
  const svg = await import_qrcode.default.toString(
    destinationUrl.toString(),
    {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 4,
      width: 1024
    }
  );
  const encodedQr = new TextEncoder().encode(svg);
  const checksum = await sha256Hex(
    encodedQr
  );
  const assetId = crypto.randomUUID();
  const deliverableId = crypto.randomUUID();
  const filenameBase = sanitizeFilename(
    project.business_name
  );
  const originalFilename = `${filenameBase}-qr-v1.svg`;
  const storageKey = [
    "customers",
    project.customer_id,
    "projects",
    project.id,
    "deliverables",
    "qr",
    "v1",
    `${assetId}.svg`
  ].join("/");
  const timestamp = nowIso();
  await env.ASSETS.put(
    storageKey,
    encodedQr,
    {
      httpMetadata: {
        contentType: "image/svg+xml"
      },
      customMetadata: {
        assetId,
        projectId: project.id,
        orderId: project.order_id,
        customerId: project.customer_id,
        businessId: project.business_id || "",
        deliverableType: "QR_CODE",
        version: "1",
        originalFilename,
        destinationUrl: destinationUrl.toString()
      }
    }
  );
  let assetInserted = false;
  try {
    await env.DB.prepare(`
        INSERT INTO assets (
          id,
          business_id,
          customer_id,
          project_id,
          asset_type,
          storage_provider,
          storage_key,
          original_filename,
          mime_type,
          size_bytes,
          checksum,
          status,
          uploaded_at,
          validated_at,
          approved_for_use,
          is_customer_supplied,
          rights_confirmed,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          'DELIVERABLE',
          'R2',
          ?,
          ?,
          'image/svg+xml',
          ?,
          ?,
          'VALID',
          ?,
          ?,
          1,
          0,
          1,
          ?
        )
      `).bind(
      assetId,
      project.business_id || null,
      project.customer_id,
      project.id,
      storageKey,
      originalFilename,
      encodedQr.byteLength,
      checksum,
      timestamp,
      timestamp,
      JSON.stringify({
        generated_by: "MENU_MADE_AUTOMATION",
        workflow_run_id: targetStep.workflow_run_id,
        workflow_step_id: targetStep.workflow_step_id,
        workflow_key: targetStep.workflow_key,
        workflow_version: Number(
          targetStep.workflow_version
        ),
        destination_url: destinationUrl.toString(),
        deliverable_type: "QR_CODE",
        deliverable_version: 1
      })
    ).run();
    assetInserted = true;
    await env.DB.prepare(`
        INSERT INTO deliverables (
          id,
          project_id,
          asset_id,
          deliverable_type,
          version,
          status,
          customer_visible,
          created_at
        )
        VALUES (
          ?,
          ?,
          ?,
          'QR_CODE',
          1,
          'DRAFT',
          0,
          ?
        )
      `).bind(
      deliverableId,
      project.id,
      assetId,
      timestamp
    ).run();
  } catch (error) {
    if (assetInserted) {
      try {
        await env.DB.prepare(`
            DELETE FROM assets
            WHERE id = ?
          `).bind(assetId).run();
      } catch {
      }
    }
    try {
      await env.ASSETS.delete(
        storageKey
      );
    } catch {
    }
    throw error;
  }
  const output = {
    generated_at: timestamp,
    reused_existing: false,
    destination_url: destinationUrl.toString(),
    asset: {
      id: assetId,
      storage_provider: "R2",
      storage_key: storageKey,
      original_filename: originalFilename,
      mime_type: "image/svg+xml",
      size_bytes: encodedQr.byteLength,
      checksum
    },
    deliverable: {
      id: deliverableId,
      type: "QR_CODE",
      version: 1,
      status: "DRAFT",
      customer_visible: false
    }
  };
  await completeStep(
    targetStep,
    output,
    env
  );
  return output;
}
__name(runGenerateQrStep, "runGenerateQrStep");
async function runQualityCheckStep(targetStep, env) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const prepared = await loadPreparedPayload(targetStep, env);
  const checks = [];
  for (const [stepKey, type, mime] of [
    ["GENERATE_MENU_DRAFT", "MENU_DRAFT", "text/html"],
    ["GENERATE_QR", "QR_CODE", "image/svg+xml"]
  ]) {
    const previous = await env.DB.prepare(`SELECT output_json FROM workflow_steps
      WHERE workflow_run_id = ? AND step_key = ? AND status = 'SUCCEEDED'
      ORDER BY step_order ASC LIMIT 1`).bind(targetStep.workflow_run_id, stepKey).first();
    const output = parseJsonOrNull(previous?.output_json);
    if (!output?.asset?.id) throw new Error(`QC: missing successful ${stepKey} output`);
    const asset = await env.DB.prepare(`SELECT a.id, a.storage_key, a.mime_type,
      a.size_bytes, a.checksum, a.status, d.customer_visible, d.status AS deliverable_status
      FROM deliverables d JOIN assets a ON a.id = d.asset_id
      WHERE d.project_id = ? AND d.deliverable_type = ? AND d.asset_id = ?
      AND a.project_id = ? LIMIT 1`).bind(targetStep.project_id, type, output.asset.id, targetStep.project_id).first();
    if (!asset || asset.status !== 'VALID' || asset.mime_type !== mime)
      throw new Error(`QC: invalid ${type} asset record`);
    if (asset.deliverable_status !== 'DRAFT' || Number(asset.customer_visible) !== 0)
      throw new Error(`QC: ${type} must remain a private draft`);
    if (asset.storage_key !== output.asset.storage_key || asset.checksum !== output.asset.checksum)
      throw new Error(`QC: ${type} output does not match persisted asset`);
    const object = await env.ASSETS.get(asset.storage_key);
    if (!object) throw new Error(`QC: ${type} object is missing from R2`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength !== Number(asset.size_bytes) || await sha256Hex(bytes) !== asset.checksum)
      throw new Error(`QC: ${type} content integrity failed`);
    const text = new TextDecoder().decode(bytes);
    if (type === 'MENU_DRAFT') {
      if (!/<html\b/i.test(text) || !/<section\b[^>]*class="menu-content"[^>]*>\s*\S/i.test(text) || /<script\b/i.test(text))
        throw new Error('QC: menu draft structure or content failed');
    } else {
      if (!/<svg\b/i.test(text) || !/<path\b/i.test(text) || /<script\b|<foreignObject\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=/i.test(text))
        throw new Error('QC: QR SVG structure failed');
      const expected = getInputValue(prepared.inputs, 'qr_destination');
      if (!expected || new URL(expected).toString() !== output.destination_url)
        throw new Error('QC: QR destination does not match prepared input');
    }
    checks.push({type, asset_id: asset.id, integrity: 'PASS', structure: 'PASS'});
  }
  const output = {checked_at: nowIso(), result: 'PASS', checks,
    scope: 'Stored file integrity, draft structure and QR destination metadata; excludes semantic menu review and QR scan verification',
    customer_visible: false};
  await completeStep(targetStep, output, env);
  return output;
}
async function runNextProductionStep(request, env) {
  const auth = verifyProductionRunner(
    request,
    env
  );
  if (!auth.ok) {
    return jsonResponse(
      {
        ok: false,
        error: auth.error
      },
      auth.status
    );
  }
  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: "D1 binding DB is not available"
      },
      500
    );
  }
  let targetStep = null;
  try {
    targetStep = await env.DB.prepare(`
          SELECT
            ws.id AS workflow_step_id,
            ws.workflow_run_id,
            ws.step_key,
            ws.step_order,
            ws.status AS step_status,

            wr.project_id,
            wr.workflow_key,
            wr.workflow_version,
            wr.status AS workflow_status,
            wr.created_at AS workflow_created_at,

            p.order_id,
            p.customer_id,
            p.business_id,
            p.status AS project_status

          FROM workflow_steps ws

          JOIN workflow_runs wr
            ON wr.id =
              ws.workflow_run_id

          JOIN projects p
            ON p.id =
              wr.project_id

          WHERE
            ws.status =
              'QUEUED'

            AND ws.step_key IN (
              'PREPARE_INPUTS',
              'GENERATE_MENU_DRAFT',
              'GENERATE_QR',
              'QUALITY_CHECK'
            )

            AND (ws.step_key != 'QUALITY_CHECK' OR wr.workflow_key = 'MENU_QR_V1')

            AND wr.status IN (
              'QUEUED',
              'RUNNING'
            )

            AND NOT EXISTS (
              SELECT 1
              FROM workflow_steps previous
              WHERE
                previous.workflow_run_id =
                  ws.workflow_run_id
                AND previous.step_order <
                  ws.step_order
                AND previous.status !=
                  'SUCCEEDED'
            )

          ORDER BY
            wr.created_at ASC,
            ws.step_order ASC

          LIMIT 1
        `).first();
    if (!targetStep) {
      return jsonResponse({
        ok: true,
        processed: false,
        message: "No runnable production step found"
      });
    }
    const timestamp = nowIso();
    const claimResult = await env.DB.prepare(`
          UPDATE workflow_steps
          SET
            status = 'RUNNING',
            started_at =
              COALESCE(
                started_at,
                ?
              ),
            attempt_count =
              attempt_count + 1,
            error_message =
              NULL
          WHERE
            id = ?
            AND status =
              'QUEUED'
        `).bind(
      timestamp,
      targetStep.workflow_step_id
    ).run();
    if (Number(
      claimResult.meta?.changes || 0
    ) === 0) {
      return jsonResponse({
        ok: true,
        processed: false,
        message: "Production step was already claimed"
      });
    }
    await env.DB.prepare(`
        UPDATE workflow_runs
        SET
          status = 'RUNNING',
          started_at =
            COALESCE(
              started_at,
              ?
            ),
          error_code = NULL,
          error_message = NULL
        WHERE id = ?
      `).bind(
      timestamp,
      targetStep.workflow_run_id
    ).run();
    await env.DB.prepare(`
        UPDATE projects
        SET
          status =
            'AUTOMATION_RUNNING',
          started_at =
            COALESCE(
              started_at,
              ?
            ),
          blocked_reason = NULL,
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      timestamp,
      targetStep.project_id
    ).run();
    let stepOutput;
    if (targetStep.step_key === "PREPARE_INPUTS") {
      const result = await runPrepareInputsStep(
        targetStep,
        env
      );
      if (result.waiting) {
        return result.response;
      }
      stepOutput = result.output;
    } else if (targetStep.step_key === "GENERATE_MENU_DRAFT") {
      stepOutput = await runGenerateMenuDraftStep(
        targetStep,
        env
      );
    } else if (targetStep.step_key === "GENERATE_QR") {
      stepOutput = await runGenerateQrStep(
        targetStep,
        env
      );
    } else if (targetStep.step_key === "QUALITY_CHECK") {
      stepOutput = await runQualityCheckStep(targetStep, env);
    } else {
      throw new Error(
        `Unsupported production step ${targetStep.step_key}`
      );
    }
    const nextStep = await findNextStep(
      targetStep,
      env
    );
    return jsonResponse({
      ok: true,
      processed: true,
      workflow_run: {
        id: targetStep.workflow_run_id,
        status: "RUNNING",
        workflow_key: targetStep.workflow_key,
        workflow_version: Number(
          targetStep.workflow_version
        )
      },
      project: {
        id: targetStep.project_id,
        status: "AUTOMATION_RUNNING"
      },
      completed_step: {
        id: targetStep.workflow_step_id,
        key: targetStep.step_key,
        status: "SUCCEEDED"
      },
      next_step: nextStep ? {
        id: nextStep.id,
        key: nextStep.step_key,
        order: Number(
          nextStep.step_order
        ),
        status: nextStep.status
      } : null,
      output: stepOutput
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (targetStep) {
      const failedAt = nowIso();
      try {
        await env.DB.prepare(`
            UPDATE workflow_steps
            SET
              status = 'FAILED',
              completed_at = ?,
              error_message = ?
            WHERE id = ?
              AND status =
                'RUNNING'
          `).bind(
          failedAt,
          errorMessage,
          targetStep.workflow_step_id
        ).run();
        await env.DB.prepare(`
            UPDATE workflow_runs
            SET
              status = 'FAILED',
              failed_at = ?,
              error_code =
                'PRODUCTION_STEP_FAILED',
              error_message = ?
            WHERE id = ?
          `).bind(
          failedAt,
          errorMessage,
          targetStep.workflow_run_id
        ).run();
        await env.DB.prepare(`
            UPDATE projects
            SET
              status = 'FAILED',
              blocked_reason = ?,
              updated_at = ?
            WHERE id = ?
          `).bind(
          errorMessage,
          failedAt,
          targetStep.project_id
        ).run();
      } catch {
      }
    }
    return jsonResponse(
      {
        ok: false,
        error: errorMessage
      },
      500
    );
  }
}
__name(runNextProductionStep, "runNextProductionStep");

// src/worker.js
async function databaseHealthCheck(env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    const result = await env.DB.prepare(`
          SELECT COUNT(*) AS application_tables
          FROM sqlite_schema
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '_cf_%'
        `).first();
    return jsonResponse({
      ok: true,
      database: "menu-made-db",
      application_tables: result?.application_tables ?? null
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
__name(databaseHealthCheck, "databaseHealthCheck");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(
        null,
        {
          headers: corsHeaders()
        }
      );
    }
    if (request.method === "GET" && url.pathname === "/api/db-health") {
      return databaseHealthCheck(
        env
      );
    }
    if (request.method === "GET" && url.pathname === "/api/offers") {
      return getPublicOffers(
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/funnel-event") {
      return recordFunnelEvent(
        request,
        env
      );
    }
    if (request.method === "GET" && url.pathname === "/api/onboarding") {
      return getOnboarding(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/onboarding") {
      return saveOnboarding(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/onboarding/upload") {
      return uploadOnboardingAsset(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/production/run-next") {
      return runNextProductionStep(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/stripe-webhook") {
      return handleStripeWebhook(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/create-checkout-test") {
      return createCheckoutSessionTest(
        request,
        env
      );
    }
    if (request.method === "POST" && (url.pathname === "/api/create-checkout" || url.pathname === "/api/create-checkout-session")) {
      return createCheckoutSession(
        request,
        env
      );
    }
    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }
};

// Direct booking support; existing Worker code above remains unchanged.
const mmBookingHandler = (() => {
const SESSIONS = new Set(['Menu + QR consultation (30 minutes)', 'Website + visibility consultation (30 minutes)', 'Project planning (30 minutes)']);
const SERVICES = new Set(['Online Menu + QR', 'Conversion Fix', 'Google Visibility', 'Accessibility Upgrade', 'Other project']);
const TIMES = new Set(['9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM', '3:00 PM']);
const ORIGINS = new Set(['https://menu-made.com', 'https://www.menu-made.com']);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty body');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new Error('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validate(data, now = new Date()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.type === 'inquiry') {
    const clean = { type: 'inquiry' };
    for (const [key, limit] of Object.entries({ name: 100, email: 150, business: 150, notes: 1200, service: 100, requestId: 36 })) {
      if (typeof data[key] !== 'string' || data[key].length > limit) return null;
      clean[key] = data[key].trim();
      if (key !== 'notes' && /[\r\n\x00]/.test(clean[key])) return null;
    }
    if (!clean.name || !clean.notes || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email) || !SERVICES.has(clean.service)) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean.requestId)) return null;
    return clean;
  }
  if (data.type !== undefined) return null;
  const limits = { name: 100, email: 150, business: 150, notes: 1200, session: 100, date: 10, time: 10, timezone: 100, requestId: 36 };
  const clean = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof data[key] !== 'string' || data[key].length > limit) return null;
    clean[key] = data[key].trim();
    if (key !== 'notes' && /[\r\n\x00]/.test(clean[key])) return null;
  }
  if (!clean.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean.requestId)) return null;
  if (!SESSIONS.has(clean.session) || !TIMES.has(clean.time)) return null;
  const date = new Date(`${clean.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== clean.date) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: clean.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = key => parts.find(item => item.type === key).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    if (clean.date <= today) return null;
  } catch { return null; }
  if (date.getTime() > now.getTime() + 366 * 86400000) return null;
  return clean;
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

const escapeEmailHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function inquiryEmailHtml(data, reference, kind) {
  const owner = kind === 'owner';
  const safe = escapeEmailHtml;
  const row = (label, value) => `<tr><td style="padding:12px 16px;border-bottom:1px solid #dce8ec;font-size:12px;font-weight:bold;color:#45616c;width:110px;vertical-align:top;">${safe(label)}</td><td style="padding:12px 16px;border-bottom:1px solid #dce8ec;font-size:15px;color:#102f3d;overflow-wrap:anywhere;">${safe(value)}</td></tr>`;
  const heading = owner ? 'New project inquiry' : 'Thanks—your inquiry is received.';
  const intro = owner
    ? `${safe(data.name)} has contacted MENU-MADE about ${safe(data.service)}. Review the details below and reply directly to this email to follow up.`
    : `Thanks for contacting MENU-MADE. We’ve received your inquiry about <strong>${safe(data.service)}</strong> and will review your project details. We’ll reply to discuss the next steps.`;
  const summary = row('Service', data.service) + (owner ? row('Name', data.name) + row('Email', data.email) : '') + (data.business ? row('Business', data.business) : '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background-color:#edf3f5;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;color:#edf3f5;max-height:0;overflow:hidden;">${owner ? 'A new MENU-MADE inquiry is ready for your review.' : 'Your project details are with MENU-MADE. We’ll reply with the next steps.'}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#edf3f5;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dce8ec;">
<tr><td style="background-color:#071f2c;padding:28px 32px;border-bottom:4px solid #00d6e6;">
<a href="https://menu-made.com" style="text-decoration:none;"><img src="https://menu-made.com/MENU1.png" width="220" alt="MENU-MADE" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a>
<p style="margin:14px 0 0;color:#bfeef0;font-size:12px;letter-spacing:1px;">MENUS · WEBSITES · ONLINE PRESENCE</p></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:1px;color:#08747b;">${owner ? 'PROJECT INQUIRY' : 'INQUIRY CONFIRMATION'}</p>
<h1 style="margin:0 0 24px;font-size:26px;line-height:1.25;color:#071f2c;">${heading}</h1>
${owner ? '' : `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#26434f;">Hi ${safe(data.name)},</p>`}
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#26434f;">${intro}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f8f9;border:1px solid #dce8ec;">${summary}</table>
<h2 style="margin:24px 0 10px;font-size:16px;color:#071f2c;">Project details</h2>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#26434f;overflow-wrap:anywhere;">${safe(data.notes).replace(/\r?\n/g, '<br>')}</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:#26434f;">${owner ? 'Use Reply to contact the customer directly.' : 'Have something to add? Reply directly to this email.'}</p>
${owner ? '' : '<p style="margin:24px 0 0;font-size:15px;color:#071f2c;">The MENU-MADE team</p>'}
</td></tr>
<tr><td style="padding:24px 32px;background-color:#071f2c;">
<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#e8f6f7;"><a href="https://menu-made.com" style="color:#5ff2ff;">menu-made.com</a> &nbsp;·&nbsp; <a href="mailto:info@menu-made.com" style="color:#5ff2ff;">info@menu-made.com</a></p>
<p style="margin:0;font-size:11px;line-height:1.6;color:#bbced5;overflow-wrap:anywhere;">Reference: ${safe(reference)}</p>
</td></tr></table>
</td></tr></table></body></html>`;
}

async function deliver(env, row) {
  const data = JSON.parse(row.payload);
  const inquiry = data.type === 'inquiry';
  const details = inquiry ? `Service: ${data.service}\nName: ${data.name}\nEmail: ${data.email}\nBusiness: ${data.business || 'Not provided'}\nProject details: ${data.notes}\nReference: ${row.id}` : `Session: ${data.session}\nPreferred date: ${data.date}\nPreferred time: ${data.time}\nTimezone: ${data.timezone}\nName: ${data.name}\nEmail: ${data.email}\nBusiness: ${data.business || 'Not provided'}\nNotes: ${data.notes || 'None'}\nReference: ${row.id}`;
  for (const kind of ['owner', 'customer']) {
    if (row[`${kind}_sent`]) continue;
    // Resend deduplicates concurrent deliveries; sent flags retain that protection after its retry window.
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `booking/${row.id}/${kind}` },
        body: JSON.stringify({
          ...(inquiry ? { html: inquiryEmailHtml(data, row.id, kind) } : {}),
          from: env.BOOKING_FROM,
          to: [kind === 'owner' ? env.BOOKING_TO : data.email],
          reply_to: kind === 'owner' ? data.email : (env.BOOKING_REPLY_TO || env.BOOKING_TO),
          subject: inquiry ? (kind === 'owner' ? `MENU-MADE project inquiry — ${data.service}` : 'MENU-MADE — project inquiry received') : kind === 'owner' ? `MENU-MADE session request — ${data.date}` : 'MENU-MADE — session request received',
          text: kind === 'owner' ? details : inquiry ? `Hello ${data.name},\n\nThanks for telling us about your project. Your inquiry was received, and we’ll reply to discuss the next steps.\n\nService: ${data.service}\nReference: ${row.id}\n\nMENU-MADE` : `Hello ${data.name},\n\nYour session request was received. We’ll reply to confirm availability; this is not a confirmed appointment.\n\nSession: ${data.session}\nPreferred date: ${data.date}\nPreferred time: ${data.time} (${data.timezone})\nReference: ${row.id}\n\nMENU-MADE`
        })
      });
      if (!response.ok) throw new Error('Email provider rejected delivery');
      await env.DB.prepare(`UPDATE mm_booking_requests SET ${kind}_sent = 1 WHERE id = ?`).bind(row.id).run();
    } catch {
      // Do not log personal details or provider responses. Durable requests remain available for retry.
      console.error(`Booking ${kind} notification pending`);
    }
  }
  await env.DB.prepare('UPDATE mm_booking_requests SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
}

return {
  async fetch(request, env, ctx) {
    if (!['/api/booking', '/api/inquiry'].includes(new URL(request.url).pathname)) return json({ ok: false }, 404);
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (!ORIGINS.has(request.headers.get('Origin'))) return json({ ok: false }, 403);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ ok: false }, 415);
    if (!env.DB || !env.RESEND_API_KEY || !env.BOOKING_FROM || !env.BOOKING_TO || !env.BOOKING_RATE_SALT) return json({ ok: false }, 503);
    let raw;
    try { raw = await readBody(request); } catch { return json({ ok: false }, 400); }
    if (typeof raw?.website !== 'string' || raw.website !== '') return json({ ok: false }, 400);
    if (new URL(request.url).pathname === '/api/inquiry' && raw.type !== 'inquiry') return json({ ok: false }, 400);
    const data = validate(raw);
    if (!data) return json({ ok: false }, 400);
    const payload = JSON.stringify(data);
    try {
      const existing = await env.DB.prepare('SELECT * FROM mm_booking_requests WHERE id = ?').bind(data.requestId).first();
      if (existing) return existing.payload === payload ? json({ ok: true, requestId: existing.id }) : json({ ok: false }, 409);
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) return json({ ok: false }, 403);
      const now = Math.floor(Date.now() / 1000);
      const ipHash = await hash(`${env.BOOKING_RATE_SALT}:${ip}`);
      // Rate checks and insertion occur in one SQL statement to prevent concurrent bypass.
      const result = await env.DB.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at)
        SELECT ?, ?, ?, ? WHERE
        (SELECT COUNT(*) FROM mm_booking_requests WHERE ip_hash = ? AND created_at > ?) < 5
        AND (SELECT COUNT(*) FROM mm_booking_requests WHERE created_at > ?) < 100
        ON CONFLICT(id) DO NOTHING`).bind(data.requestId, payload, ipHash, now, ipHash, now - 3600, now - 3600).run();
      if (!result.meta.changes) {
        const concurrent = await env.DB.prepare('SELECT * FROM mm_booking_requests WHERE id = ?').bind(data.requestId).first();
        if (concurrent) return concurrent.payload === payload ? json({ ok: true, requestId: concurrent.id }) : json({ ok: false }, 409);
        return json({ ok: false }, 429);
      }
      ctx.waitUntil(deliver(env, { id: data.requestId, payload, owner_sent: 0, customer_sent: 0 }).catch(() => console.error('Booking notification retry required')));
      return json({ ok: true, requestId: data.requestId }, 201);
    } catch {
      console.error('Booking persistence failed');
      return json({ ok: false }, 503);
    }
  },
  async scheduled(_event, env, ctx) {
    if (!env.DB || !env.RESEND_API_KEY || !env.BOOKING_FROM || !env.BOOKING_TO) return;
    ctx.waitUntil((async () => {
      const cutoff = Math.floor(Date.now() / 1000) - 20 * 3600;
      const rows = await env.DB.prepare('SELECT * FROM mm_booking_requests WHERE (owner_sent = 0 OR customer_sent = 0) AND created_at > ? AND attempts < 12 ORDER BY created_at LIMIT 10').bind(cutoff).all();
      for (const row of rows.results) await deliver(env, row);
    })());
  }
};

})();
function mmBookingEnvironment(env) {
  return {
    ...env,
    BOOKING_FROM: env.BOOKING_FROM || FROM_ADDRESS,
    BOOKING_TO: env.BOOKING_TO || INTERNAL_BCC,
    BOOKING_REPLY_TO: env.BOOKING_REPLY_TO || REPLY_TO_ADDRESS,
    BOOKING_RATE_SALT: env.BOOKING_RATE_SALT || env.PRODUCTION_RUNNER_SECRET || env.RESEND_API_KEY
  };
}
const mmWorkerWithBooking = {
  async fetch(request, env, ctx) {
    if (['/api/booking', '/api/inquiry'].includes(new URL(request.url).pathname)) {
      return mmBookingHandler.fetch(request, mmBookingEnvironment(env), ctx);
    }
    return worker_default.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    return mmBookingHandler.scheduled(event, mmBookingEnvironment(env), ctx);
  }
};

export {
  mmWorkerWithBooking as default
};
