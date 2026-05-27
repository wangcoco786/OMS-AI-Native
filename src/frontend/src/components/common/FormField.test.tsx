import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FormField } from './FormField';

describe('FormField', () => {
  it('renders label and children', () => {
    render(
      <FormField label="用户名" name="username">
        <input id="username" type="text" />
      </FormField>
    );
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
  });

  it('shows required indicator when required', () => {
    render(
      <FormField label="邮箱" name="email" required>
        <input id="email" type="email" />
      </FormField>
    );
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not show required indicator when not required', () => {
    render(
      <FormField label="备注" name="notes">
        <input id="notes" type="text" />
      </FormField>
    );
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  it('displays error message with alert role', () => {
    render(
      <FormField label="密码" name="password" error="密码不能为空">
        <input id="password" type="password" />
      </FormField>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('密码不能为空');
  });

  it('does not display error when no error prop', () => {
    render(
      <FormField label="名称" name="name">
        <input id="name" type="text" />
      </FormField>
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
