import { type ReactNode, useState, useCallback, useRef, type DragEvent } from 'react';
import { useImportCSV } from '@/hooks/use-sku-mapping';
import styles from './BulkImport.module.css';

export function BulkImport(): ReactNode {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMutation = useImportCSV();

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      setSelectedFile(file);
    }
  }, []);

  const handleFileSelect = useCallback(() => {
    const file = fileInputRef.current?.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleUpload = useCallback(() => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  }, [selectedFile, importMutation]);

  const handleReset = useCallback(() => {
    setSelectedFile(null);
    importMutation.reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [importMutation]);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>批量导入渠道 SKU</h2>
      <p className={styles.description}>上传 CSV 文件批量导入渠道 SKU 数据，系统将自动进行匹配。</p>

      {!importMutation.isSuccess && (
        <>
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="点击或拖拽上传 CSV 文件"
          >
            <div className={styles.dropIcon}>📄</div>
            <p className={styles.dropText}>
              {selectedFile ? selectedFile.name : '拖拽 CSV 文件到此处，或点击选择文件'}
            </p>
            {selectedFile && (
              <p className={styles.fileSize}>
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className={styles.fileInput}
              onChange={handleFileSelect}
              aria-label="选择 CSV 文件"
            />
          </div>

          {importMutation.isPending && (
            <div className={styles.progressBar} role="progressbar" aria-label="上传进度">
              <div className={styles.progressFill} />
              <span className={styles.progressText}>正在导入...</span>
            </div>
          )}

          {importMutation.isError && (
            <div className={styles.errorMessage} role="alert">
              导入失败：{importMutation.error.message}
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.uploadBtn}
              disabled={!selectedFile || importMutation.isPending}
              onClick={handleUpload}
            >
              {importMutation.isPending ? '导入中...' : '开始导入'}
            </button>
          </div>
        </>
      )}

      {importMutation.isSuccess && importMutation.data && (
        <div className={styles.resultSection}>
          <h3 className={styles.resultTitle}>导入完成</h3>
          <div className={styles.resultStats}>
            <div className={styles.resultStat}>
              <span className={styles.resultStatValue}>{importMutation.data.totalRecords}</span>
              <span className={styles.resultStatLabel}>总记录数</span>
            </div>
            <div className={`${styles.resultStat} ${styles.successStat}`}>
              <span className={styles.resultStatValue}>{importMutation.data.successCount}</span>
              <span className={styles.resultStatLabel}>成功</span>
            </div>
            {importMutation.data.errorCount > 0 && (
              <div className={`${styles.resultStat} ${styles.errorStat}`}>
                <span className={styles.resultStatValue}>{importMutation.data.errorCount}</span>
                <span className={styles.resultStatLabel}>失败</span>
              </div>
            )}
          </div>

          {importMutation.data.errors && importMutation.data.errors.length > 0 && (
            <div className={styles.errorList}>
              <h4 className={styles.errorListTitle}>错误详情</h4>
              <ul>
                {importMutation.data.errors.map((err, idx) => (
                  <li key={idx} className={styles.errorListItem}>
                    第 {err.row} 行：{err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            重新导入
          </button>
        </div>
      )}
    </div>
  );
}
