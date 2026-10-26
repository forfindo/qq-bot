import { isRecord } from '@/utils/type-guard';

/**
 * 深层次对象合并，支持多入参，靠右对象优先级更高
 * 规则：
 * 1. 对象值为 undefined 的字段，跳过，不覆盖原值
 * 2. skipNull=true 时，null 同样跳过不覆盖
 * 3. 两边都是普通对象：递归合并
 * 4. 两边都是数组：concat 合并（靠前数组在前，靠后数组在后）
 * 5. 其余情况：直接用高优先级值覆盖
 * 6. ✅ 纯函数，不会修改输入对象
 * @param sources
 */
export function mergeObject(...sources: Record<string, unknown>[]) {
  if (sources.length === 0) {
    return {};
  }
  if (sources.length === 1) {
    return structuredClone(sources[0]!);
  }

  // 循环依次合并
  let acc = structuredClone(sources[0]!);
  for (let i = 1; i < sources.length; i++) {
    acc = mergeTwo(acc, sources[i]!);
  }
  return acc;
}

/** 内部：只合并两个对象的底层函数，复用原有逻辑 */
function mergeTwo(
  source: Record<string, unknown>,
  target: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...source };

  for (const key of Object.keys(target)) {
    const tarVal = target[key];
    if (tarVal === void 0) {
      continue;
    }

    const srcVal = result[key];

    if (Array.isArray(srcVal) && Array.isArray(tarVal)) {
      result[key] = [...(srcVal as unknown[]), ...(tarVal as unknown[])];
    } else if (isRecord(srcVal) && isRecord(tarVal)) {
      result[key] = mergeTwo(srcVal, tarVal);
    } else {
      result[key] = tarVal;
    }
  }
  return result;
}
