import { useState, useCallback, type ReactNode, type ChangeEvent } from 'react';
import { FormField } from '@/components/common';
import { useOnboardingStore } from '@/stores/onboarding-store';
import styles from './Steps.module.css';

interface ShippingRule {
  id: string;
  condition: string;
  action: string;
}

interface RuleSetupData {
  defaultShippingMethod: string;
  weightRules: ShippingRule[];
  regionRules: ShippingRule[];
}

interface ValidationErrors {
  defaultShippingMethod?: string;
}

const SHIPPING_METHODS = [
  { value: 'standard', label: '标准快递' },
  { value: 'express', label: '加急快递' },
  { value: 'economy', label: '经济配送' },
  { value: 'same_day', label: '当日达' },
  { value: 'pickup', label: '自提' },
];

let ruleIdCounter = 0;
function generateRuleId(): string {
  return `rule-${Date.now()}-${++ruleIdCounter}`;
}

export function validateRuleSetup(data: RuleSetupData): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.defaultShippingMethod) {
    errors.defaultShippingMethod = '请选择默认配送方式';
  }

  return errors;
}

export function RuleSetupStep(): ReactNode {
  const { stepData, setStepData } = useOnboardingStore();
  const savedData = stepData.rule_setup.data as Partial<RuleSetupData> | undefined;

  const [formData, setFormData] = useState<RuleSetupData>({
    defaultShippingMethod: savedData?.defaultShippingMethod || '',
    weightRules: savedData?.weightRules || [],
    regionRules: savedData?.regionRules || [],
  });

  const [errors, setErrors] = useState<ValidationErrors>({});

  const persistData = useCallback(
    (data: RuleSetupData) => {
      setStepData('rule_setup', data as unknown as Record<string, unknown>);
    },
    [setStepData],
  );

  const handleMethodChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setFormData((prev) => {
        const next = { ...prev, defaultShippingMethod: value };
        persistData(next);
        return next;
      });
      if (value) {
        setErrors((prev) => ({ ...prev, defaultShippingMethod: undefined }));
      }
    },
    [persistData],
  );

  const addWeightRule = useCallback(() => {
    setFormData((prev) => {
      const next = {
        ...prev,
        weightRules: [...prev.weightRules, { id: generateRuleId(), condition: '', action: '' }],
      };
      persistData(next);
      return next;
    });
  }, [persistData]);

  const removeWeightRule = useCallback(
    (id: string) => {
      setFormData((prev) => {
        const next = { ...prev, weightRules: prev.weightRules.filter((r) => r.id !== id) };
        persistData(next);
        return next;
      });
    },
    [persistData],
  );

  const updateWeightRule = useCallback(
    (id: string, field: 'condition' | 'action', value: string) => {
      setFormData((prev) => {
        const next = {
          ...prev,
          weightRules: prev.weightRules.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
        };
        persistData(next);
        return next;
      });
    },
    [persistData],
  );

  const addRegionRule = useCallback(() => {
    setFormData((prev) => {
      const next = {
        ...prev,
        regionRules: [...prev.regionRules, { id: generateRuleId(), condition: '', action: '' }],
      };
      persistData(next);
      return next;
    });
  }, [persistData]);

  const removeRegionRule = useCallback(
    (id: string) => {
      setFormData((prev) => {
        const next = { ...prev, regionRules: prev.regionRules.filter((r) => r.id !== id) };
        persistData(next);
        return next;
      });
    },
    [persistData],
  );

  const updateRegionRule = useCallback(
    (id: string, field: 'condition' | 'action', value: string) => {
      setFormData((prev) => {
        const next = {
          ...prev,
          regionRules: prev.regionRules.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
        };
        persistData(next);
        return next;
      });
    },
    [persistData],
  );

  return (
    <div className={styles.stepContainer}>
      <h2 className={styles.stepTitle}>规则配置</h2>
      <p className={styles.stepDescription}>
        配置物流规则，包括默认配送方式和基于重量/地区的规则。
      </p>

      <div className={styles.formGrid}>
        <FormField
          label="默认配送方式"
          name="defaultShippingMethod"
          required
          error={errors.defaultShippingMethod}
        >
          <select
            id="defaultShippingMethod"
            className={styles.select}
            value={formData.defaultShippingMethod}
            onChange={handleMethodChange}
          >
            <option value="">请选择配送方式</option>
            {SHIPPING_METHODS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className={styles.ruleSection}>
        <div className={styles.ruleSectionHeader}>
          <h3 className={styles.ruleSectionTitle}>重量规则</h3>
          <button type="button" className={styles.addRuleBtn} onClick={addWeightRule}>
            + 添加规则
          </button>
        </div>

        {formData.weightRules.length === 0 ? (
          <p className={styles.emptyRules}>暂无重量规则，点击"添加规则"创建。</p>
        ) : (
          <div className={styles.ruleList}>
            {formData.weightRules.map((rule) => (
              <div key={rule.id} className={styles.ruleRow}>
                <input
                  type="text"
                  className={styles.ruleInput}
                  value={rule.condition}
                  onChange={(e) => updateWeightRule(rule.id, 'condition', e.target.value)}
                  placeholder="条件（如：重量 > 5kg）"
                  aria-label="重量规则条件"
                />
                <span className={styles.ruleArrow}>→</span>
                <input
                  type="text"
                  className={styles.ruleInput}
                  value={rule.action}
                  onChange={(e) => updateWeightRule(rule.id, 'action', e.target.value)}
                  placeholder="动作（如：使用顺丰快递）"
                  aria-label="重量规则动作"
                />
                <button
                  type="button"
                  className={styles.removeRuleBtn}
                  onClick={() => removeWeightRule(rule.id)}
                  aria-label="删除此重量规则"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.ruleSection}>
        <div className={styles.ruleSectionHeader}>
          <h3 className={styles.ruleSectionTitle}>地区规则</h3>
          <button type="button" className={styles.addRuleBtn} onClick={addRegionRule}>
            + 添加规则
          </button>
        </div>

        {formData.regionRules.length === 0 ? (
          <p className={styles.emptyRules}>暂无地区规则，点击"添加规则"创建。</p>
        ) : (
          <div className={styles.ruleList}>
            {formData.regionRules.map((rule) => (
              <div key={rule.id} className={styles.ruleRow}>
                <input
                  type="text"
                  className={styles.ruleInput}
                  value={rule.condition}
                  onChange={(e) => updateRegionRule(rule.id, 'condition', e.target.value)}
                  placeholder="条件（如：地区 = 新疆/西藏）"
                  aria-label="地区规则条件"
                />
                <span className={styles.ruleArrow}>→</span>
                <input
                  type="text"
                  className={styles.ruleInput}
                  value={rule.action}
                  onChange={(e) => updateRegionRule(rule.id, 'action', e.target.value)}
                  placeholder="动作（如：加收 15 元运费）"
                  aria-label="地区规则动作"
                />
                <button
                  type="button"
                  className={styles.removeRuleBtn}
                  onClick={() => removeRegionRule(rule.id)}
                  aria-label="删除此地区规则"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
