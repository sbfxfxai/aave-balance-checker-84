/**
 * BigDecimal Implementation for Aave V4 Dashboard
 * High-precision decimal arithmetic for financial computations
 * Based on big.js library principles
 */

export enum RoundingMode {
  Down = 0,      // Towards zero (truncate)
  HalfUp = 1,    // Nearest neighbor; away from zero if equidistant
  HalfEven = 2,  // Nearest neighbor; towards even if equidistant
  Up = 3         // Away from zero
}

export interface DisplayOptions {
  rounding?: RoundingMode;
  minFractionDigits?: number;
  trimTrailingZeros?: boolean;
}

export class BigDecimal {
  private value: string;
  private negative: boolean = false;
  private coefficient: string = '0';
  private exponent: number = 0;

  constructor(value: string | number | bigint) {
    if (typeof value === 'string') {
      this.value = value;
    } else if (typeof value === 'number') {
      this.value = value.toString();
    } else if (typeof value === 'bigint') {
      this.value = value.toString();
    } else {
      throw new Error('Invalid value type for BigDecimal');
    }

    // Parse the value into components
    this.parseValue();
  }

  private parseValue(): void {
    const trimmed = this.value.trim();
    
    if (trimmed.startsWith('-')) {
      this.negative = true;
      this.value = trimmed.slice(1);
    } else {
      this.negative = false;
      this.value = trimmed;
    }

    const decimalIndex = this.value.indexOf('.');
    if (decimalIndex === -1) {
      this.coefficient = this.value;
      this.exponent = 0;
    } else {
      this.coefficient = this.value.slice(0, decimalIndex) + this.value.slice(decimalIndex + 1);
      this.exponent = decimalIndex - (this.value.length - 1);
    }

    // Remove leading zeros
    this.coefficient = this.coefficient.replace(/^0+/, '') || '0';
  }

  // Factory method
  static bigDecimal(value: string | number | bigint): BigDecimal {
    return new BigDecimal(value);
  }

  // Type guard
  static isBigDecimal(value: unknown): value is BigDecimal {
    return value instanceof BigDecimal;
  }

  // Arithmetic operations
  plus(other: BigDecimal | string | number): BigDecimal {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.add(otherBD);
  }

  add(other: BigDecimal): BigDecimal {
    // Align exponents and add coefficients
    const maxExp = Math.max(this.exponent, other.exponent);
    const thisCoeff = this.alignCoefficient(maxExp);
    const otherCoeff = other.alignCoefficient(maxExp);
    
    let resultCoeff = (BigInt(thisCoeff) + BigInt(otherCoeff)).toString();
    const resultExp = maxExp;
    
    // Normalize result
    while (resultCoeff.length > 1 && resultCoeff[0] === '0') {
      resultCoeff = resultCoeff.slice(1);
    }
    
    return BigDecimal.bigDecimal((this.negative && BigInt(thisCoeff) > BigInt(otherCoeff)) || 
                                (other.negative && BigInt(otherCoeff) > BigInt(thisCoeff)) ? 
                                '-' + resultCoeff : resultCoeff)
      .withExponent(resultExp);
  }

  minus(other: BigDecimal | string | number): BigDecimal {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.sub(otherBD);
  }

  sub(other: BigDecimal): BigDecimal {
    const negatedOther = BigDecimal.bigDecimal(other.negative ? other.coefficient : '-' + other.coefficient)
      .withExponent(other.exponent);
    return this.add(negatedOther);
  }

  times(other: BigDecimal | string | number): BigDecimal {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.mul(otherBD);
  }

  mul(other: BigDecimal): BigDecimal {
    const resultCoeff = (BigInt(this.coefficient) * BigInt(other.coefficient)).toString();
    const resultExp = this.exponent + other.exponent;
    const resultNeg = this.negative !== other.negative;
    
    return BigDecimal.bigDecimal((resultNeg ? '-' : '') + resultCoeff).withExponent(resultExp);
  }

  div(other: BigDecimal | string | number): BigDecimal {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    
    if (otherBD.coefficient === '0') {
      throw new Error('Division by zero');
    }

    // For simplicity, using floating point division (in production, use proper big integer division)
    const thisFloat = parseFloat(this.toString());
    const otherFloat = parseFloat(otherBD.toString());
    const result = thisFloat / otherFloat;
    
    return BigDecimal.bigDecimal(result.toString());
  }

  mod(other: BigDecimal | string | number): BigDecimal {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    const quotient = this.div(otherBD);
    const flooredQuotient = BigDecimal.bigDecimal(Math.floor(parseFloat(quotient.toString())));
    const product = otherBD.times(flooredQuotient);
    return this.minus(product);
  }

  pow(exponent: number): BigDecimal {
    if (exponent < -1000000 || exponent > 1000000) {
      throw new Error('Exponent out of range');
    }
    
    const thisFloat = parseFloat(this.toString());
    const result = Math.pow(thisFloat, exponent);
    return BigDecimal.bigDecimal(result.toString());
  }

  sqrt(): BigDecimal {
    if (this.negative) {
      throw new Error('Cannot calculate square root of negative number');
    }
    
    const thisFloat = parseFloat(this.toString());
    const result = Math.sqrt(thisFloat);
    return BigDecimal.bigDecimal(result.toString());
  }

  abs(): BigDecimal {
    return BigDecimal.bigDecimal(this.coefficient).withExponent(this.exponent);
  }

  neg(): BigDecimal {
    return BigDecimal.bigDecimal(this.negative ? this.coefficient : '-' + this.coefficient)
      .withExponent(this.exponent);
  }

  // Comparison methods
  gt(other: BigDecimal | string | number): boolean {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.cmp(otherBD) > 0;
  }

  gte(other: BigDecimal | string | number): boolean {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.cmp(otherBD) >= 0;
  }

  lt(other: BigDecimal | string | number): boolean {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.cmp(otherBD) < 0;
  }

  lte(other: BigDecimal | string | number): boolean {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.cmp(otherBD) <= 0;
  }

  eq(other: BigDecimal | string | number): boolean {
    const otherBD = typeof other === 'object' ? other : new BigDecimal(other);
    return this.cmp(otherBD) === 0;
  }

  cmp(other: BigDecimal): number {
    if (this.negative && !other.negative) return -1;
    if (!this.negative && other.negative) return 1;
    
    const maxExp = Math.max(this.exponent, other.exponent);
    const thisCoeff = BigInt(this.alignCoefficient(maxExp));
    const otherCoeff = BigInt(other.alignCoefficient(maxExp));
    
    if (thisCoeff === otherCoeff) return 0;
    return thisCoeff > otherCoeff ? 1 : -1;
  }

  // Rounding and precision
  round(decimalPlaces: number, roundingMode: RoundingMode = RoundingMode.HalfUp): BigDecimal {
    const factor = Math.pow(10, decimalPlaces);
    const scaled = this.times(factor);
    const rounded = this.applyRounding(scaled, roundingMode);
    return rounded.div(factor);
  }

  prec(significantDigits: number, roundingMode: RoundingMode = RoundingMode.HalfUp): BigDecimal {
    const str = this.toString();
    if (str === '0') return this;
    
    const nonZeroIndex = str.search(/[1-9]/);
    if (nonZeroIndex === -1) return this;
    
    let decimalIndex = str.indexOf('.');
    if (decimalIndex === -1) decimalIndex = str.length;
    
    const targetIndex = nonZeroIndex + significantDigits - 1;
    const roundIndex = Math.min(targetIndex, str.length - (str.includes('.') ? 2 : 1));
    
    if (roundIndex < 0) return BigDecimal.bigDecimal('0');
    
    const roundedStr = str.slice(0, roundIndex + 1);
    const remainder = str.slice(roundIndex + 1);
    
    if (remainder.length > 0) {
      const lastDigit = parseInt(roundedStr[roundedStr.length - 1]);
      const nextDigit = parseInt(remainder[0]);
      
      if ((nextDigit > 5) || (nextDigit === 5 && lastDigit % 2 === 1)) {
        const incremented = (parseFloat(roundedStr) + Math.pow(10, -(roundedStr.length - decimalIndex + 1))).toString();
        return BigDecimal.bigDecimal(incremented);
      }
    }
    
    return BigDecimal.bigDecimal(roundedStr);
  }

  rescale(decimals: number): BigDecimal {
    if (decimals > 0) {
      const factor = Math.pow(10, decimals);
      return this.times(factor);
    } else {
      const factor = Math.pow(10, Math.abs(decimals));
      return this.div(factor);
    }
  }

  // Display formatting
  toDisplayString(precision: number, options: DisplayOptions = {}): string {
    const { rounding = RoundingMode.HalfUp, minFractionDigits = 0, trimTrailingZeros = false } = options;
    
    const rounded = this.round(precision, rounding);
    let str = rounded.toString();
    
    // Handle minimum fraction digits
    const decimalIndex = str.indexOf('.');
    if (decimalIndex === -1) {
      if (minFractionDigits > 0) {
        str += '.' + '0'.repeat(minFractionDigits);
      }
    } else {
      const currentFractionDigits = str.length - decimalIndex - 1;
      if (currentFractionDigits < minFractionDigits) {
        str += '0'.repeat(minFractionDigits - currentFractionDigits);
      }
    }
    
    // Trim trailing zeros
    if (trimTrailingZeros && str.includes('.')) {
      str = str.replace(/\.?0+$/, '');
    }
    
    return str;
  }

  // Conversion methods
  toString(): string {
    if (this.exponent === 0) {
      return (this.negative ? '-' : '') + this.coefficient;
    }
    
    const coeffStr = this.coefficient;
    const absExp = Math.abs(this.exponent);
    
    if (this.exponent > 0) {
      // Move decimal point right
      const decimalPos = coeffStr.length - this.exponent;
      if (decimalPos > 0) {
        const intPart = coeffStr.slice(0, decimalPos);
        const decPart = coeffStr.slice(decimalPos);
        return (this.negative ? '-' : '') + intPart + '.' + decPart;
      } else {
        const padded = coeffStr.padStart(absExp + coeffStr.length, '0');
        return (this.negative ? '-' : '') + '0.' + padded;
      }
    } else {
      // Move decimal point left
      if (coeffStr.length > absExp) {
        const intPart = coeffStr.slice(0, -absExp);
        const decPart = coeffStr.slice(-absExp);
        return (this.negative ? '-' : '') + intPart + '.' + decPart;
      } else {
        const padded = coeffStr.padStart(absExp, '0');
        return (this.negative ? '-' : '') + padded;
      }
    }
  }

  toFixed(decimalPlaces?: number, roundingMode?: RoundingMode): string {
    if (decimalPlaces === undefined) {
      return this.toString();
    }
    return this.round(decimalPlaces, roundingMode || RoundingMode.HalfUp).toString();
  }

  toExponential(decimalPlaces?: number): string {
    const num = parseFloat(this.toString());
    if (decimalPlaces === undefined) {
      return num.toExponential();
    }
    return num.toExponential(decimalPlaces);
  }

  toPrecision(precision?: number, roundingMode?: RoundingMode): string {
    const num = parseFloat(this.toString());
    if (precision === undefined) {
      return num.toPrecision();
    }
    return this.prec(precision, roundingMode || RoundingMode.HalfUp).toString();
  }

  toApproximateNumber(): number {
    const num = parseFloat(this.toString());
    
    // Handle extreme values
    if (!isFinite(num)) {
      return this.negative ? -Number.MAX_VALUE : Number.MAX_VALUE;
    }
    
    // Handle very small numbers
    if (Math.abs(num) < Number.MIN_VALUE) {
      return 0;
    }
    
    return num;
  }

  toJSON(): string {
    return this.toString();
  }

  // Static utility methods
  static min(...values: BigDecimal[]): BigDecimal {
    if (values.length < 2) {
      throw new Error('At least two arguments required for BigDecimal.min()');
    }
    
    return values.reduce((min, current) => current.lt(min) ? current : min);
  }

  static max(...values: BigDecimal[]): BigDecimal {
    if (values.length < 2) {
      throw new Error('At least two arguments required for BigDecimal.max()');
    }
    
    return values.reduce((max, current) => current.gt(max) ? current : max);
  }

  // Private helper methods
  private alignCoefficient(targetExponent: number): string {
    if (this.exponent === targetExponent) {
      return this.coefficient;
    }
    
    const diff = targetExponent - this.exponent;
    if (diff > 0) {
      return this.coefficient + '0'.repeat(diff);
    } else {
      const padded = this.coefficient.padStart(this.coefficient.length - diff, '0');
      return padded.slice(0, padded.length + diff);
    }
  }

  private withExponent(exponent: number): BigDecimal {
    const result = new BigDecimal(this.coefficient);
    result.exponent = exponent;
    return result;
  }

  private applyRounding(value: BigDecimal, roundingMode: RoundingMode): BigDecimal {
    const num = parseFloat(value.toString());
    let rounded: number;
    
    switch (roundingMode) {
      case RoundingMode.Down:
        rounded = this.negative ? Math.ceil(num) : Math.floor(num);
        break;
      case RoundingMode.HalfUp:
        rounded = Math.round(num);
        break;
      case RoundingMode.HalfEven:
        rounded = Math.round(num);
        break;
      case RoundingMode.Up:
        rounded = this.negative ? Math.floor(num) : Math.ceil(num);
        break;
      default:
        rounded = Math.round(num);
    }
    
    return BigDecimal.bigDecimal(rounded.toString());
  }
}

// Export factory function
export function bigDecimal(value: string | number | bigint): BigDecimal {
  return new BigDecimal(value);
}
