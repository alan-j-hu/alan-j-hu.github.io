---
title: "The Case for Pattern Matching"
subtitle: "A tutorial on two pattern match compilation algorithms"
published: 2022-04-08
tags: ["compilers"]
---

Pattern matching is a powerful programming language feature for performing
case analysis over a data type. Patterns, a high-level description of the forms
which data may take, more closely resemble the logic of the problem domain than
lower-level control structures, promoting more readable and concise code.
In recognition of these benefits, popular programming languages are now
adopting pattern matching, and I advocate for its further adoption. However,
how to compile pattern matching to low-level control flow is not obvious, so in
hopes of making pattern matching a more accessible feature for language
implementors, I will show two algorithms to compile pattern matching,
[Augustsson (1985)](https://www.ccs.neu.edu/~types/resources/a-fpca-1985.pdf)
and [Maranget (2008)
](http://moscova.inria.fr/~maranget/papers/ml05e-maranget.pdf).

## Motivating Example: Symbolic Differentiation

Pattern matching is useful for domains that involve symbolic manipulation
because it allows programmers to write declarative functions that resemble
mathematical equations. Take, for instance, symbolic differentiation of
rational fractions, which are polynomials extended with division. The following
is an OCaml type definition of rational fractions:

```ocaml
type rational =
  | X                          (** Variable *)
  | Const of float             (** Constant *)
  | Add of rational * rational (** Sum of rational fractions *)
  | Mul of rational * rational (** Product of rational fractions *)
  | Div of rational * rational (** Quotient of rational fractions *)
```

The above data type defines the forms that a rational fraction may take: A
rational fraction is either a variable, a constant, the sum of rational
fractions, the product of rational fractions, or the quotient of rational
fractions. (\\(x^2\\) is represented as `Mul(X, X)`.) One can then write a
function that finds the derivative of a rational fraction by pattern matching
on each form:

```ocaml
let rec deriv = function
  | X -> Const 1.0
  | Const c -> Const 0.0
  | Add(u, v) -> Add(deriv u, deriv v)
  | Mul(u, v) -> Add(Mul(v, deriv u), Mul(u, deriv v))
  | Div(u, v) ->
    Div(Add(Mul(v, deriv u), Mul(Const(-1.0), Mul(u, deriv v))),
        Mul(v, v))
```

Each clause of this function corresponds with a mathematical rule for finding
the derivative:

<p>
$$
\begin{align*}
\frac{dx}{dx} &= 1\\
\frac{dC}{dx} &= 0\\
\frac{d}{dx}(u + v) &= \frac{du}{dx} + \frac{dv}{dx}\\
\frac{d}{dx}(uv) &= v\frac{du}{dx} + u\frac{dv}{dx}\\
\frac{d}{dx}(\frac{u}{v}) &= \frac{v\frac{du}{dx} - u\frac{dv}{dx}}{v^2}\\
\end{align*}
$$
</p>

Therefore, pattern matching facilitates a straightforward translation from
mathematics to programs.

## Motivating Example: Red-Black Trees

Not only is pattern matching useful for domains that involve symbols, it is
also useful for implementing classic algorithms and data structures. Consider
this OCaml type definition of red-black trees:

```ocaml
type color = Red | Black

type 'a tree =
  | Empty
  | Node of color * 'a tree * 'a * 'a tree
```

To remain balanced, a red-black tree maintains the invariant that a red node
cannot have a red child. There are four ways to violate this invariant:

- The red left child's left child is red
- The red left child's right child is red
- The red right child's left child is red
- The red right child's right child is red

```ocaml
let balance (l : 'a tree) (v : 'a) (r : 'a tree) : 'a tree * 'a * 'a tree =
  match l, v, r with
  | Node(Red, Node(Red, t1, a, t2), b, t3), c, t4
  | Node(Red, t1, a, Node(Red, t2, b, t3)), c, t4
  | t1, a, Node(Red, Node(Red, t2, b, t3), c, t4)
  | t1, a, Node(Red, t2, b, Node(Red, t3, c, t4)) ->
    Node(Red, t1, a, t2), b, Node(Red, t3, c, t4)
  | l, v, r -> l, v, r
```

The above function handles each case. This function uses three notable
features: First, it features non-trivial nested patterns by matching on
subtrees. Second, it has overlapping patterns because if the function were
passed two red nodes with a red child, or a red node with two red children,
multiple clauses would match the arguments. In the case of multiple matches,
the higher clause takes precedence. Third, the function uses or-patterns by
mapping four cases to the same rebalanced tree.

The equivalent code to balance a red-black tree using control structures
such as if-statements instead of pattern matching would have been less clear
and therefore more prone to bugs. Pattern matching promotes readable and
correct code.

## Adoption of Pattern Matching

Variations of pattern matching have seen increasing mainstream adoption as
programmers and language designers have realized its value. Pattern matching
over data types first appeared in a language called NPL. The HOPE language
would combine NPL's pattern matching feature with functional programming
language features from the LCF dialect of ML [[MacQueen, Harper, and Reppy
(2020)](https://smlfamily.github.io/history/SML-history.pdf)]. [Swift](
https://docs.swift.org/swift-book/ReferenceManual/Patterns.html) and [Rust](
https://doc.rust-lang.org/stable/reference/patterns.html) are two modern
languages that support a version of pattern matching close to how it appears in
ML dialects. Other languages have retrofitted more limited forms of pattern
matching onto their existing designs. C++17 supports [*structured binding*](
https://en.cppreference.com/w/cpp/language/structured_binding) to decompose
objects and adds [std::variant](
https://en.cppreference.com/w/cpp/utility/variant), a tagged union that can
be dispatched by type, to the standard library. Python has long supported
[assignment to comma-separated targets](
https://docs.python.org/3/reference/simple_stmts.html#assignment-statements),
and since [version 3.10](https://www.python.org/downloads/release/python-3100/)
has ["structural pattern matching."](https://peps.python.org/pep-0634/) [Java
SE 17](
https://docs.oracle.com/en/java/javase/17/language/pattern-matching.html) adds
pattern matching over an object's type in switch statements. What distinguishes
ML's pattern matching from other variations are:

- Data types to constrain the forms that matchable data may take
- Data deconstruction and case analysis as a unified feature
- Composition of patterns through nesting to describe more precise cases

Non-nested patterns simply compile to a multi-way branch. The challenge is
compiling nested patterns, but this nesting is precisely what gives pattern
matching its full power, as seen in the red-black tree example. Algorithms for
compiling pattern matching show how to translate nested patterns into nested
cases and jumps. Now, I will show two such algorithms, Augustsson (1985) and
Maranget (2008). For both algorithms, I will work through the compilation of
the Ackermann function defined with pattern matching. I've intentionally
swapped the two parameters when matching on them to apply the tricky fourth
case of Augustsson's algorithm:

```ocaml
type nat = Zero | Suc of nat
(** A natural number is either 0 or n+1 where n is a natural number *)

let rec ackermann x y = match y, x with
  | n, Zero -> Suc n
  | Zero, Suc m -> ackermann m (Suc Zero)
  | Suc n, Suc m -> ackermann m (ackermann (Suc m) n)
```

## Augustsson's Algorithm

Augustsson (1985) presents an algorithm for compiling pattern matching to
simple case expressions which only dispatch on the outermost constructor,
permitting straightforward translation to low-level code. In Augustsson's
algorithm, a pattern \\(p\\) is either a variable pattern \\(v\_i\\), which
matches any term and binds the term to the variable \\(v\_i\\), or a
constructor pattern \\(C^i(p_1\cdots p_n)\\), which matches a value of the form
\\(C^i(e_1\cdots e_n)\\) where \\(p_1\cdots p_n\\) matches \\(e_1\cdots e_n\\).

Let \\(\textbf{C}\\) be the pattern match compiler function, called as:

<p>
$$
\begin{align*}
\textbf{C}(\langle e_1\cdots e_n\rangle,
\begin{pmatrix}
\langle p_{1,1}\cdots p_{1,n}\rangle: & E_1\\
\langle p_{2,1}\cdots p_{2,n}\rangle: & E_2\\
\vdots\\
\langle p_{m,1}\cdots p_{m,n}\rangle: & E_m\\
\end{pmatrix},
d)
\end{align*}
$$
</p>

where the first argument is the list of expressions to match, the second
argument is the list of pattern clauses, and the third argument is the default
expression if all the matches fail.

\\(\textbf{C}\\) compiles nested patterns into code that performs a
left-to-right and depth-first examination of terms. If a pattern match fails,
the generated code backtracks. The definition of \\(\textbf{C}\\) proceeds in
cases:

### Case 0

<p>
$$
\begin{align*}
\textbf{C}(\langle e_1\cdots e_n\rangle,
\begin{pmatrix}
\end{pmatrix},
d) := d
\end{align*}
$$
</p>

This zeroeth case does not appear in Augustsson's paper (instead he handles it
in the third case), but creating a separate case simplifies presentation. When
the clause list is empty, the pattern match compiles to the default action
\\(d\\). In all subsequent cases, the clause list contains at least one clause.

### Case 1

<p>
$$
\begin{align*}
\textbf{C}(\langle \rangle,
\begin{pmatrix}
\langle \rangle: & E_1\\
\langle \rangle: & E_2\\
\vdots\\
\langle \rangle: & E_m\\
\end{pmatrix},
d) := E_1
\end{align*}
$$
</p>

In the first case, \\(\langle e_1\cdots e_m\rangle\\) is empty. In this case,
the resulting code is \\(E_1\\).

### Case 2

<p>
$$
\begin{align*}
& \textbf{C}(\langle e_1,e_2\cdots e_n\rangle,
\begin{pmatrix}
\langle v_1,p_{1,2}\cdots p_{1,n}\rangle: & E_1\\
\langle v_2,p_{2,2}\cdots p_{2,n}\rangle: & E_2\\
\vdots\\
\langle v_n,p_{n,2}\cdots p_{m,n}\rangle: & E_m\\
\end{pmatrix},
d):=\\
&\textbf{let}\: v = e_1 \textbf{in}\\
& \textbf{C}(\langle e_2\cdots e_n\rangle,
\begin{pmatrix}
\langle p_{1,2}\cdots p_{1,n}\rangle: & E_1[v_1:=v]\\
\langle p_{2,2}\cdots p_{2,n}\rangle: & E_2[v_2:=v]\\
\vdots\\
\langle p_{m,2}\cdots p_{m,n}\rangle: & E_m[v_n:=v]\\
\end{pmatrix},
d)
\end{align*}
$$
</p>

In the second case, \\(\langle e\_1\cdots e\_n\rangle\\) contains at least one
term, and all the patterns in the first column are variable patterns. The
compiler removes \\(e\_1\\) from the list of terms and generates a new variable
for it, then substitutes this variable for the corresponding variable pattern
in each body expression. Compilation then continues on \\(e\_2\cdots e\_n\\)
and the corresponding remaining patterns in the clauses.

### Case 3

<p>
$$
\begin{align*}
& \textbf{C}(\langle e_1,e_2\cdots e_n\rangle,
\begin{pmatrix}
\langle C_1(q\cdots),p_{1,2}\cdots p_{1,n}\rangle: & E_1\\
\vdots\\
\langle C_k(q\cdots),p_{k,2}\cdots p_{k,n}\rangle: & E_k\\
\langle v_{k+1},p_{k+1,2}\cdots p_{k+1,n}\rangle: & E_{k+1}\\
\vdots\\
\langle v_m,p_{m,2}\cdots p_{m,n}\rangle: & E_m\\
\end{pmatrix},
d):=\\
& \textbf{case}\: e_1 \textbf{of}\\
& \mid C^1(v^1_1\cdots v^1_j)
\to \textbf{C}(\langle v^1_1\cdots v^1_j,e_2\cdots e_n \rangle,
M^1,
\textbf{default})\\
& \qquad\vdots\\
& \mid C^N(v^N_1\cdots v^N_{j'})
\to \textbf{C}(\langle v^N_1\cdots v^N_{j'},e_2\cdots e_n \rangle, M^N,
\textbf{default})\\
& \mid v \to \textbf{C}(\langle e_2\cdots e_n \rangle,
\begin{pmatrix}
\langle p_{k+1,2}\cdots p_{k+1,n}\rangle: & E_{k+1}[v_{k+1}:=v]\\
& \vdots\\
\langle p_{m,2}\cdots p_{m,n}\rangle: & E_m[v_n:=v]\\
\end{pmatrix},
d)\\
\end{align*}
$$
</p>

In the third case, \\(\langle e\_1 \cdots e\_n\rangle\\) contains at least one
element, and in the first column, any (possibly none) variable patterns appear
below all constructor patterns. The compiler generates a case analysis on
\\(e\_1\\) with branches for each distinct constructor \\(C^1\cdots C^N\\) that
appears in the first column, where clause list \\(M^i\\) for each constructor
\\(C^i\\) is a function of clauses \\(1\cdots k\\). The compiler also generates
a catch-all variable case to handle all constructors of the data type which do
not appear in a pattern in the first column. \\(\textbf{default}\\) is a
special instruction in the intermediate language that backtracks to the nearest
enclosing variable pattern case in the compiled code.

For each constructor case \\(C^i\\), the compiler generates new variables
\\(v^i\_1\cdots v^i\_j\\) as names for each subterm of the scrutinee. Then, the
compiler generates a new clause list \\(M^i\\) from clauses \\(1\cdots k\\) by
replacing all matching clauses, in the form
\\(\\langle C^i(q\_1\\cdots q\_a),p\_2\\cdots p\_n\\rangle: E\\), with
\\(\\langle q_1\\cdots q_a,p_2\cdots p_n\\rangle: E\\) and filtering out
all non-matching clauses, in the form
\\(\\langle C^j(q\_1\cdots q\_j),p\_2\\cdots p\_n\\rangle: E\\) where
\\(C^i\neq C^j\\). In each constuctor case, matching continues on
\\(\\langle v^i_1\cdots v^i\_j,e\_2\cdots e\_n\\rangle\\).

In the catch-all case, variables are again substituted as appropriate, and
matchng continues on \\(\\langle e\_2\cdots e\_n\\rangle\\).

### Case 4

<p>
$$
\begin{align*}
& \textbf{C}(\langle e_1\cdots e_n\rangle,
\begin{pmatrix}
\langle C_1(q_1\cdots),p_{1,2}\cdots p_{1,n}\rangle: &E_1\\
\langle C_2(q_2\cdots),p_{2,2}\cdots p_{2,n}\rangle: & E_2\\
\vdots\\
\langle x_k,p_{k,2}\cdots p_{k,n}\rangle: & E_2\\
\langle C_{k+1}(q_\cdots),p_{k+1,2}\cdots p_{k+1,n}\rangle: & E_2\\
\vdots\\
\langle x_m,p_{m,2}\cdots p_{m,n}\rangle: & E_n\\
\end{pmatrix},
d):=\\
& \textbf{let}\:d_\ell = d\:\textbf{in}\\
& \textbf{let}\:d_{\ell-1} = \textbf{C}(\langle e_1\cdots e_n\rangle, P_\ell, d_\ell)\:\textbf{in}\\
& \qquad\vdots \\
& \textbf{let}\:d_2 = \textbf{C}(\langle e_1\cdots e_n\rangle, P_3, d_3)\:\textbf{in}\\
& \textbf{let}\:d_1 = \textbf{C}(\langle e_1\cdots e_n\rangle, P_2, d_2)\:\textbf{in}\\
& \textbf{C}(\langle e_1\cdots e_n\rangle, P_1, d_1) \\
\end{align*}
$$
</p>

In the fourth and last case, \\(\langle e\_1 \cdots e\_n\rangle\\) contains at
least one element and in the first column of patterns, a variable pattern in
clause \\(k\\) appears above a constructor pattern in clause \\(k+1\\).
Augustsson proposes two ways to compile this case: The first is to compute a
new pattern that captures the overlap between two patterns which must switch
places, and inserting it between them. The second, which is what he illustrates
in the paper, is to split the clause list into the longest subsequences
\\(P\_1,P\_2,\cdots P\_\\ell\\) such that the third case applies to each of them
alone, then compile each subsequence as a separate match and generate code that
tries them in succession. (Therefore, given two adjacent subsequences
\\(P\\) and \\(P'\\), the last clause of \\(P\\) will begin with a variable
pattern and the first clause of \\(P'\\) will begin with a constructor
pattern.)

Note that Augustsson developed his algorithm in the context of Lazy ML, so
each definition \\(\\:d_i = \\cdots\\) is not evaluated until necessary. In an
eagerly evaluated setting, the appropriate adjustments should be made, such as
deferring each definition under a lambda abstraction.

### Example: Ackermann

Now, consider how to use Augustsson's algorithm to compile the pattern match
from the Ackermann definition:

```ocaml
match y, x with
| x1, Zero -> 1
| Zero, Suc x2 -> 2
| Suc x3, Suc x4 -> 3
```

There are two scrutinees, `y` and `x`. (Technically, in OCaml, there is one
scrutinee, which is the tuple expression `y, x`, but for demonstration
purposes, assume that the tuple has already been expanded to match on its
parts.) The variables `m` and `n` bound in the original Ackermann definition
have been renamed to unique names `x1`, `x2`, `x3`, and `x4` to clearly
distinguish between different variables, bound in different clauses, which
happen to share the same name. The clause right-hand-sides have also been
replaced with numbers. The initial invocation of Augustsson's function is:

<p>
$$
\begin{align*}
\textbf{C}(\langle y, x \rangle,
\begin{pmatrix}
\langle x_1, Zero \rangle: & E_1\\
\langle Zero, Suc\:x_2 \rangle: & E_2\\
\langle Suc\:x_3, Suc\:x_4 \rangle: & E_3\\
\end{pmatrix},
\text{raise (Match_failure("", 0, 0))})
\end{align*}
$$
</p>

The following is the generated code commented with the rules that generated
each section:

```ocaml
(* By Case 4
   P_0:
   x1, Zero -> 1
   P_1:
   Zero, Suc x2 -> 2
   Suc x3, Suc x4 -> 3 *)
let d2 () = raise (Match_failure("", 0, 0)) in
let d1 () =
  (* Scrutinees: y, x
     Clauses = P_1:
     Zero, Suc x2 -> 2
     Suc x3, Suc x4 -> 3 *)
  (* By Case 3 *)
  match y with
  | Zero ->
    (* Scrutinees: x
       Clauses:
       Suc x2 -> 2 *)
    (* By Case 3 *)
    begin match x with
      | Suc x2 -> 2 (* By Case 1 *)
      | _ -> default
    end
  | Suc v1 ->
    (* Scrutinees: v1, x
       Clauses:
       x3, Suc x4 -> 3 *)
    (* By Case 2 *)
    let x3 = v1 in
    (* Scrutinees: x
       Clauses:
       Suc x4 -> 3 *)
    (* By Case 3 *)
    begin match x with
      | Suc x4 -> 3 (* By Case 1 *)
      | _ -> default
    end
  | _ -> d2 () (* default jumps here *)
in
(* Scrutinees: y, x
   Clauses = P_0:
   x1, Zero -> 1 *)
(* By Case 2 *)
let x1 = y in
(* Scrutinees: x
   Clauses:
   Zero -> 1 *)
(* By Case 3 *)
match x with
| Zero -> 1 (* By Case 1 *)
| _ -> d1 ()
```

## Maranget's Algorithm

Maranget (2008) presents another algorithm for compiling pattern matches.
Maranget's approach has an advantage over Augustsson's because Augustsson's
algorithm may generate backtracking *automata*, but Maranget's algorithm
generates a *decision tree*, which examines a scrutinee at most once. In
contrast, decision trees have the disadvantage of code size blow-up in
comparison to automata. I will continue to use Augustsson's notation when
showing Maranget's algorithm for consistency.

In Maranget's algorithm, a pattern \\(p\\) is either a wildcard pattern
\\(\\_\\), which matches any term, a constructor pattern
\\(C^i(p\_1\cdots p\_M)\\), or an or-pattern \\(p\_1\\mid p\_2\\). Maranget
then rewrites all patterns of the form \\(\\\_\\mid p\_2\\) into \\(\\\_\\).
Therefore, a pattern \\(p\\) is either a wildcard pattern \\(\\\_\\) or a
*generalized constructor pattern* \\(q\\), which is either
\\(C(p\_1\cdots p\_j)\\) or an or-pattern in the form \\(q\\mid p\\). In
other words, a wildcard can only appear at the end of an or-pattern sequence.

Maranget defines a compilation function \\(CC\\), which takes the following
form where the first argument is the list of expressions to match and the
second argument is the list of pattern clauses:

<p>
$$
\begin{align*}
& CC(\langle e_1\cdots e_n\rangle,
\begin{pmatrix}
\langle p_{1,1}\cdots p_{1,n}\rangle: & E_1\\
\langle p_{2,1}\cdots p_{2,n}\rangle: & E_2\\
\vdots\\
\langle p_{m,1}\cdots p_{m,n}\rangle: & E_m\\
\end{pmatrix})
\end{align*}
$$
</p>

Unlike Augustsson's \\(C\\) function, which always matches on the first term
in the list, Maranget's \\(CC\\) chooses the next term to match based on the
clause list. The resulting code never backtracks or examines the same term
twice. Like Augustsson's algorithm, upon matching a term, Maranget's algorithm
replaces it with its subterms in the list of pending terms to match.

### Case 1

<p>
$$
\begin{align*}
& CC(\langle e_1\cdots e_n\rangle,
\begin{pmatrix}
\end{pmatrix}) := fail
\end{align*}
$$
</p>

If the clause list is empty, the pattern match fails.

### Case 2

<p>
$$
\begin{align*}
& CC(\langle e_1\cdots e_n\rangle,
\begin{pmatrix}
\langle \__{1,1}\cdots \__{1,n}\rangle: & E_1\\
\vdots\\
\langle p_{m,1}\cdots p_{m,n}\rangle: & E_m\\
\end{pmatrix}) := E_1
\end{align*}
$$
</p>

If the first clause only consist of wildcards, the pattern match compiles to
\\(E_1\\).

### Case 3

<p>
$$
\begin{align*}
& CC(\langle e_1\cdots e_i\cdots e_n\rangle,
\begin{pmatrix}
\langle p_{1,1}\cdots q_{1,i} \cdots p_{1,n}\rangle: & E_1\\
\vdots\\
\langle p_{m,1}\cdots p_{m,i} \cdots p_{m,n}\rangle: & E_m\\
\end{pmatrix}\textbf{as}\:P \to A):=\\
& \textbf{case}\: e_i \textbf{of}\\
& \mid C^1(v^1_1\cdots v^1_k)
\to CC(\langle e_1\cdots e_{i-1},v^1_1\cdots v^1_k,e_{i+1}\cdots e_n \rangle,
S(C^j, P \to A))\\
& \qquad\vdots\\
& \mid C^N(v^N_1\cdots v^N_{k'})\to
CC(\langle e_1\cdots e_{i-1},v^N_1\cdots v^N_{k'},e_{i+1}\cdots e_n \rangle,
S(C^j, P \to A))\\
& \mid v\to
CC(\langle e_1\cdots e_{i-1},e_{i+1}\cdots e_n \rangle, D(P \to A))\\
\end{align*}
$$
</p>

Otherwise, there exists some column at index \\(i\\) whose top pattern is a
generalized constructor pattern. Maranget divides this case into two sub-cases,
when \\(i=1\\) and \\(i>1\\), the latter case which he rewrites into the former
with a column swap. However, I believe that the swap adds more complexity, so
I've chosen to explain the rule in terms of the general \\(i\\) case.

The term \\(e\_i\\) is tested, and for each constructor that appears in column
\\(i\\), compilation proceeds to replace \\(e\_i\\) with its subterms and
compile the corresponding pattern matches for the new list of terms. There
is also a catch-all case, in which \\(e\_i\\) is removed from the list of
terms, but no subterms are inserted. To compute the new clauses to compile
in the constructor and catch-all cases, Maranget defines two helper operations
over clauses: specialization \\(S\\) and default \\(D\\) respectively.

For each constructor that appears in column \\(i\\), the compiler performs
specialization on the list of clauses. Specialization against a constructor
\\(C^j\\) handles four possible cases for each clause:

<p>
$$
\begin{align*}
&\langle p_1\cdots p_{i-1},\_,p_{i+1}\cdots p_N\rangle: E &&\mapsto&&
\langle p_1\cdots p_{i-1},\__1\cdots \__a,p_{i+1}\cdots p_N \rangle: E\\
&\langle p_1\cdots p_{i-1},C^j(q_1\cdots q_a),p_{i+1}\cdots p_N\rangle: E
&&\mapsto&&
\langle p_1\cdots p_{i-1},q_1\cdots q_a,p_{i+1}\cdots p_N \rangle: E\\
&\langle p_1\cdots p_{i-1},C^k(q_1\cdots q_a),p_{i+1}\cdots p_N\rangle: E
&&\mapsto&&\begin{pmatrix}
\text{No rows}
\end{pmatrix}, C^j \neq C^k\\
&\langle p_1\cdots p_{i-1},(q \mid p),p_{i+1}\cdots p_N\rangle: E &&\mapsto
     && S(C^j, \langle p_1\cdots p_{i-1},q,p_{i+1}\cdots p_N\rangle: E)\\
& && && S(C^j, \langle p_1\cdots p_{i-1},p,p_{i+1}\cdots p_N\rangle: E)\\
\end{align*}
$$
</p>

- If the pattern is a wildcard, return a single clause consisting of the
  input clause with the wildcard pattern replaced by wildcards for each subterm
  of the constructor.
- If the pattern is a matching constructor, return a single clause consisting
  of the input clause with the constructor pattern replaced by its child
  patterns.
- If the pattern is a non-matching constructor, return an empty list of
  clauses.
- If the pattern is an or-pattern, split the clause into two for each
  sub-pattern and concatenate the specializations of each.

The compiler also generates a default matrix, which discards all
clauses whose \\(i^\text{th}\\) pattern does not match everything:

<p>
$$
\begin{align*}
&\langle p_1\cdots p_{i-1},\_,p_{i+1}\cdots p_N\rangle: E &&\mapsto&&
\langle p_1\cdots p_{i-1},p_{i+1}\cdots p_N\rangle: E\\
&\langle p_1\cdots p_{i-1},C^k(q_1\cdots q_a),p_{i+1}\cdots p_N\rangle: E
&&\mapsto&&\begin{pmatrix}\text{No rows}\end{pmatrix}\\
&\langle p_1\cdots p_{i-1},(q \mid p),p_{i+1}\cdots p_N\rangle: E &&\mapsto
     && D(\langle p_1\cdots p_{i-1},q,p_{i+1}\cdots p_N\rangle: E)\\
& && && D(\langle p_1\cdots p_{i-1},p,p_{i+1}\cdots p_N\rangle: E)\\
\end{align*}
$$
</p>

- If the pattern is a wildcard, return a single clause consisting of the
  input clause without the wildcard pattern.
- If the pattern is a constructor, return an empty list of clauses.
- If the pattern is an or-pattern, split the clause into two for each
  sub-pattern and concatenate the defaults of each.

When there are multiple columns with a generalized constructor pattern in the
top row, Maranget recommends using a heuristic to select a column \\(i\\) that
will result in an optimal decision tree.

### Example: Ackermann

Consider the same example from before:

```ocaml
match y, x with
| x1, Zero -> 1
| Zero, Suc x2 -> 2
| Suc x3, Suc x4 -> 3
```

To compile it with Maranget's algorithm, the initial invokation of his function
is:

<p>
$$
\begin{align*}
\textbf{CC}(\langle y, x \rangle,
\begin{pmatrix}
\langle x_1, Zero \rangle: & E_1\\
\langle Zero, Suc\:x_2 \rangle: & E_2\\
\langle Suc\:x_3, Suc\:x_4 \rangle: & E_3\\
\end{pmatrix})
\end{align*}
$$
</p>

The following is the generated code:

```ocaml
(* Scrutinees: y, x
   Clauses:
   x1, Zero -> 1
   Zero, Suc x2 -> 2
   Suc x3, Suc x4 -> 3 *)
(* By Case 3, second column selected *)
match x with
| Zero ->
  (* Scrutinees: y
     Clauses:
     x1 -> 1 *)
  (* By Case 2 *)
  let x1 = y in 1
| Suc v1 ->
  (* Scrutinees: y, v1
     Clauses:
     Zero, x2 -> 2
     Suc x3, x4 -> 3 *)
  (* By Case 3, first column selected *)
  begin match y with
    | Zero ->
      (* Scrutinees: v1
         Clauses:
         x2 -> 2 *)
      (* By Case 2 *)
      let x2 = v1 in 2
    | Suc v2 ->
      (* Scrutinees: v2, v1
         Clauses:
         x3, x4 -> 3 *)
      (* By Case 2 *)
      let x3 = v2 and x4 = v1 in 3
  end
```

## Conclusion

Notice that in Augustsson's algorithm, the pattern match compiler must apply
the complicated fourth case and split the clauses list because a variable
pattern appears above a constructor pattern in the first column, while in
Maranget's algorithm, the compiler simply matches against the second column
first. The Ackermann function definition is an example where Maranget's
decision-tree is simpler than Augustsson's backtracking automaton. A seemingly
innocuous decision such as the order of terms can drastically impact the code
that a naive compiler generates, hence why good algorithms are important.

Neither Augustsson's nor Maranget's algorithms fully address variable bindings.
Languages such as OCaml and Haskell support *as-patterns*, which bind a
variable to a term while matching the term against some wrapped pattern.
As-patterns subsume variable patterns, which can be expressed as an as-pattern
wrapping a wildcard pattern, and as-patterns additionally allow binding a
variable to a term while matching the term against a constructor. One can
trivially generalize Augustsson's algorithm to support as-patterns by inserting
let bindings whenever a variable appears and substituting appropriately in the
subsequent code. Meanwhile, Maranget's paper only briefly suggests how to
implement binding at all, focusing on control flow. The Ackermann example
demonstrates how to bind variables in wildcard patterns in Maranget's
algorithm. To bind variables in constructor patterns, extend the specialization
operation by substituting the scrutinee for any variables bound by the removed
constructor pattern in each clause.

Pattern matching is a powerful programming language feature that allows people
to write code that closely resembles the high-level domain logic. Pattern
matching is entering the mainstream as more programming languages are
adopting it. ML-style pattern matching is one variation of pattern matching
which benefits from type safety, composability of patterns, and the ability to
compile to low-level branching without an expensive runtime support library. I
have shown two algorithms, Augustsson (1985) and Maranget (2008), for compiling
ML-style pattern matching.

Not only are mainstream languages adopting elements of ML-style pattern
matching, research languages are continuing to innovate on top of ML-style pattern
matching. [Agda](
https://agda.readthedocs.io/en/v2.6.2.1/language/function-definitions.html)
supports ML-style pattern matching over dependent types and codata types.
Matching over dependent types can refine the types of other terms and rule out
cases as unreachable. Matching over codata types *defines* a potentially
infinite computation by how to inspect it. For an algorithm to compile Agda's
pattern matching, see [Cockx and Abel (2018)](
https://jesper.sikanda.be/files/elaborating-dependent-copattern-matching.pdf).
In addition to ML-style patterns, [F#](
https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/active-patterns)
has active patterns, which do not correspond with the constructors of a data
type. ML-style pattern matching is not the culmination of programming language
evolution, and programming languages cannot improve unless experimenters try
new ideas.

Finally, pattern match compilation is just one step in compilation of a
programming language. If enough people express interest, I would like to show
the process of compiling a typed functional language from source to binary. If
you like this post and want to learn more, please let me know what you would
like to learn about!

*Special thanks to [@2over12](https://github.com/2over12) for feedback on this
post.*
