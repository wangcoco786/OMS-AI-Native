import { useState, useCallback, type ReactNode, type ChangeEvent } from 'react';
import { FormField } from '@/components/common';
import { useOnboardingStore } from '@/stores/onboarding-store';
import styles from './Steps.module.css';

interface BasicConfigData {
  shopName: string;
  shopDescription: string;
  defaultWarehouse: string;
  defaultCurrency: string;
  timezone: string;
}

interface ValidationErrors {
  shopName?: string;
  shopDescription?: string;
  defaultWarehouse?: string;
  defaultCurrency?: string;
  timezone?: string;
}

const CURRENCY_OPTIONS = [
  { value: 'CNY', label: 'CNY - 人民币' },
  { value: 'USD', label: 'USD - 美元' },
  { value: 'EUR', label: 'EUR - 欧元' },
  { value: 'GBP', label: 'GBP - 英镑' },
  { value: 'JPY', label: 'JPY - 日元' },
];

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
  { value: 'America/New_York', label: 'America/New_York (UTC-5)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-8)' },
  { value: 'Europe/London', label: 'Europe/London (UTC+0)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (UTC+1)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
];

const WAREHOUSE_OPTIONS = [
  { value: 'wh-shanghai', label: '上海仓' },
  { value: 'wh-beijing', label: '北京仓' },
  { value: 'wh-guangzhou', label: '广州仓' },
  { value: 'wh-shenzhen', label: '深圳仓' },
];

export function validateBasicConfig(data: BasicConfigData): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.shopName.trim()) {
    errors.shopName = '店铺名称不能为空';
  } else if (data.shopName.trim().length < 2) {
    errors.shopName = '店铺名称至少 2 个字符';
  }

  return errors;
}

export function BasicConfigStep(): ReactNode {
  const { stepData, setStepData } = useOnboardingStore();
  const savedData = stepData.basic_config.data as Partial<BasicConfigData> | undefined;

  const [formData, setFormData] = useState<BasicConfigData>({
    shopName: savedData?.shopName || '',
    shopDescription: savedData?.shopDescription || '',
    defaultWarehouse: savedData?.defaultWarehouse || '',
    defaultCurrency: savedData?.defaultCurrency || 'CNY',
    timezone: savedData?.timezone || 'Asia/Shanghai',
  });

  const [errors, setErrors] = useState<ValidationErrors>({});

  const handleChange = useCallback(
    (field: keyof BasicConfigData) =>
      (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const value = e.target.value;
        const next = { ...formData, [field]: value };
        setFormData(next);
        setStepData('basic_config', next as unknown as Record<string, unknown>);

        // Real-time validation for shopName
        if (field === 'shopName') {
          if (!value.trim()) {
            setErrors((prev) => ({ ...prev, shopName: '店铺名称不能为空' }));
          } else if (value.trim().length < 2) {
            setErrors((prev) => ({ ...prev, shopName: '店铺名称至少 2 个字符' }));
          } else {
            setErrors((prev) => ({ ...prev, shopName: undefined }));
          }
        } else if (errors[field]) {
          setErrors((prev) => ({ ...prev, [field]: undefined }));
        }
      },
    [formData, errors, setStepData],
  );

  return (
    <div className={styles.stepContainer}>
      <h2 className={styles.stepTitle}>基础配置</h2>
      <p className={styles.stepDescription}>
        填写店铺基本信息，包括名称、默认仓库和货币设置。
      </p>

      <div className={styles.formGrid}>
        <FormField label="店铺名称" name="shopName" required error={errors.shopName}>
          <input
            id="shopName"
            type="text"
            className={styles.input}
            value={formData.shopName}
            onChange={handleChange('shopName')}
            placeholder="输入店铺名称"
          />
        </FormField>

        <FormField label="店铺描述" name="shopDescription">
          <textarea
            id="shopDescription"
            className={styles.textarea}
            value={formData.shopDescription}
            onChange={handleChange('shopDescription')}
            placeholder="简要描述店铺业务（可选）"
            rows={3}
          />
        </FormField>

        <FormField label="默认仓库" name="defaultWarehouse">
          <select
            id="defaultWarehouse"
            className={styles.select}
            value={formData.defaultWarehouse}
            onChange={handleChange('defaultWarehouse')}
          >
            <option value="">请选择默认仓库</option>
            {WAREHOUSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="默认货币" name="defaultCurrency">
          <select
            id="defaultCurrency"
            className={styles.select}
            value={formData.defaultCurrency}
            onChange={handleChange('defaultCurrency')}
          >
            {CURRENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="时区" name="timezone">
          <select
            id="timezone"
            className={styles.select}
            value={formData.timezone}
            onChange={handleChange('timezone')}
          >
            {TIMEZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
    </div>
  );
}
