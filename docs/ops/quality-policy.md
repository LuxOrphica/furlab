# FurLab Engineering Quality Policy (v1.0)

## 1. Цель
Не допускать деградацию кода: сломанные фичи, мусорные правки, битые кодировки, нестабильные интерфейсы, скрытые регрессии.

## 2. Базовые принципы
- Код должен быть читаемым и проверяемым.
- Любая правка должна быть воспроизводима локально и в CI.
- Нельзя доверять на слово — только через автоматические гейты.
- Маленькие PR лучше больших.

## 3. Обязательные гейты (без них merge запрещен)
- `encoding:check` (UTF-8 без BOM, LF, final newline).
- `lint` (ESLint/TypeScript rules).
- `typecheck` (`tsc --noEmit`, если TS).
- `test` (unit + integration + mode testcases).
- `ui:smoke` для затронутых UI-модулей.
- Security scan зависимостей (`npm audit`/Snyk/Dependabot policy).
- Coverage threshold (не ниже baseline).

## 4. Локальные требования до коммита
- Pre-commit hook: format + lint + encoding check.
- Pre-push hook: быстрые тесты критических модулей.
- Запрещены коммиты с отключенными тестами/линтами.

## 5. Стандарты кода
- Один formatter для всех (Prettier/Biome), без ручного "стиля".
- Строгие правила линтера (no any, no dead code, no console в prod-коде).
- Явные границы модулей: UI / domain / infra.
- Запрещены "god files": лимит размера файла (например, 800-1200 строк) и функции (например, 80-120 строк).
- Новая логика — только с тестом.

## 6. Контракты и архитектура
- API changes только через versioned contract.
- Для спорных решений — ADR (Architecture Decision Record).
- Для режимов/алгоритмов — обязательные инварианты и oracle cases.
- Нельзя ломать backward compatibility без миграции.

## 7. Review-политика
- Минимум 1-2 reviewer, не из автора.
- Review checklist обязателен:
  - есть тест на новый кейс;
  - нет silent fallback;
  - нет скрытых побочных эффектов;
  - соблюдены контракты/инварианты.
- PR без "Commands I ran + PASS" отклоняется.

## 8. Операционные практики (кроме Git)
- CODEOWNERS по зонам ответственности.
- CI Quality Gate как единственный путь в `main`.
- Feature flags для рискованных изменений.
- Canary/staged rollout для прод-изменений.
- Observability: логи, метрики, error budget.
- Post-merge monitoring + авто-rollback критерии.
- Dependency governance: pinning, обновления по расписанию.
- Security policy: SAST/DAST, секреты через vault, secret scanning.
- Knowledge sharing: короткие design notes и demo после крупных PR.

## 9. Definition of Done
Задача считается завершенной только если:
- Все гейты зеленые в CI.
- Есть тесты/артефакты, подтверждающие поведение.
- Документация/контракт обновлены (если менялось поведение).
- Нет открытых blocker-risk без явного waiver.

## 10. Нарушения и исключения
- Исключения допускаются только через explicit waiver (кто одобрил, срок, план закрытия).
- "Потом починим" без тикета и дедлайна запрещено.
