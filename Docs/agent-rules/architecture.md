# Reusable Architecture Rules

1. Keep structured application data as the source of truth. Treat UI and generated representations as views over that data.
2. Keep domain rules, validation and data transformations outside UI components. Prefer pure functions for reusable model behavior.
3. Decompose a nontrivial feature before implementation: model helpers, a focused controller or coordinator, small presentation components, persistent types when needed, and focused behavior tests.
4. Keep coordination layers thin. Delegate cohesive responsibilities to named modules instead of accumulating unrelated logic in a provider, reducer, modal or workspace.
5. Avoid creating or expanding UI components beyond roughly 250 lines without a clear reason. Explain necessary exceptions and keep pure logic extracted. Line count is a review guideline, not a reason to fragment coherent code mechanically.
6. Give helpers names that describe their responsibility. Do not use a general utility module as a home for unrelated domain behavior.
