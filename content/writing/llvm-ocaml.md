+++
title = "Pointers Opaque, Pointers Naked"
subtitle = "Contributing to the OCaml bindings to LLVM"
layout = "post.jingoo"
published = 2023-03-06
[taxonomies]
tags = ["compilers", "ffi", "ocaml", "llvm"]
+++

Over the past few months, I've been contributing code for LLVM's OCaml bindings
and learned a lot about both the OCaml internals and the LLVM patch submission
process. Because not all of this knowledge is documented, I will discuss what I
learned to help other people contribute to the bindings.

The bindings are an area where two projects, LLVM and OCaml, intersect, and
the evolution of both these projects left code using deprecated features, which
my patches updated. In previous versions of LLVM IR, pointer types carried the
type of their pointee, a [design problem](
https://www.npopov.com/2021/06/02/Design-issues-in-LLVM-IR.html#pointer-element-types)
because pointers frequently needed casts and relying on the pointee type for
code transformations was incorrect anyway. LLVM is [migrating](
https://www.npopov.com/2022/12/20/This-year-in-LLVM-2022.html#opaque-pointers)
from typed pointers to opaque pointers, which don't carry the type of their
pointee. My first few patches brought several functions in OCaml API up to date
with the C API, which has deprecated the old functions for working with typed
pointers and introduced replacements that use opaque pointers. On OCaml's end,
the much anticipated multicore runtime released with OCaml 5 removed support
for [naked pointers](https://discuss.ocaml.org/t/ann-a-dynamic-checker-for-detecting-naked-pointers/5805), or pointers out of the OCaml heap that are treated
as OCaml values. Naked pointers, which were already discouraged in OCaml 4, add
overhead to the GC, which must distinguish them from the pointers to managed
memory. This performance sacrifice was too much for OCaml 5's new runtime. My
largest patch replaced all instances of naked pointers in the bindings.

Since I've previously used CMake, building LLVM was straightforward, and most
of my difficulties related to the interaction between CMake and OCaml. Nikita
Popov has a [comprehensive tutorial](
https://developers.redhat.com/articles/2022/12/20/how-contribute-llvm) about
contributing to LLVM that walks through the steps from building the code to
submitting a patch for review on LLVM's [Phabricator instance](
https://reviews.llvm.org), so I'll discuss the aspects specific to OCaml.
CMake will only enable the bindings if it locates the `ocamlfind` executable
and the [`ctypes`](https://opam.ocaml.org/packages/ctypes/) and
[`ctypes-foreign`](https://opam.ocaml.org/packages/ctypes-foreign/) packages.
In the case of success, CMake will output something similar to:

```
-- Found OCaml: /home/alan/.opam/5.0.0/bin/ocamlfind  
-- OCaml bindings enabled.
```

If CMake is missing one of the requirements, it will output:

```
-- OCaml bindings disabled.
```

To test the code with and without naked pointers, I had to switch between OCaml
4.14 and OCaml 5. Running `opam switch 4.14.1` or `opam switch 5.0.0`, then
`$(eval opam env)` is not enough to make LLVM build with the desired OCaml
version. When CMake generates the build system, it saves the path to
`ocamlfind`, which the build system will continue to use even after changing
switches. I ended up keeping multiple build directories, each for a different
OCaml version.

After generating the build files with CMake, I ran
`ninja check-llvm-bindings-ocaml` to build and test the bindings. Occasionally,
the tests failed due to the OCaml debuginfo library being missing; in this
case, I ran `ninja ocaml_llvm_debuginfo`, then built the tests again. I also
sometimes got "inconsistent assumptions over interface" errors, in which case
I deleted all OCaml build results and rebuilt them (deleting the entire build
directory was not necessary). Since CMake is intended for building C and
C++ code, I am not surprised that using it with OCaml wasn't as seamless.

While I did not require deep knowledge of OCaml to bring the bindings up to
date with the opaque pointer API, I learned a lot about OCaml's runtime over
the course of replacing naked pointers. The OCaml manual suggests several ways
instead of naked pointers to expose foreign pointers as OCaml values: OCaml
uses the LSB to distinguish between pointers and non-pointers; pointers have a
LSB of 0 and non-pointers, such as integers, Booleans, and nullary
constructors, have a LSB of 1. If pointers out of the OCaml heap are at least
2-byte aligned, the OCaml manual [suggests](
https://v2.ocaml.org/manual/intfc.html#ss:c-outside-head) exposing them to
OCaml by setting the LSB to 1. Other solutions involve wrapping the foreign
pointer in an OCaml heap allocation, so the solution of setting the LSB is the
most efficient one. Josh Berdine, a past contributor to the bindings, suggested
that I could assume pointers originating from LLVM are 2-byte aligned and use
the LSB tagging scheme. Josh Berdine also patiently and carefully reviewed my
code over its many revisions, and I am grateful to him for spending his time to
see my patch to completion.

The OCaml FFI documentation gives [rules](
https://v2.ocaml.org/manual/intfc.html#s%3Ac-gc-harmony) such as:

> 1. A function that has parameters or local variables of type `value` must
> begin with a call to one of the `CAMLparam` macros and return with
> `CAMLreturn`, `CAMLreturn0`, or `CAMLreturnT`. In particular, `CAMLlocal` and
> `CAMLxparam` can only be called after `CAMLparam`.<br/>...
>
> 2. Local variables of type `value` must be declared with one of the
> `CAMLlocal` macros. Arrays of values are declared with `CAMLlocalN`. These
> macros must be used at the beginning of the function, not in a nested block.
> <br/>...
>
> ...

However, the rules in the OCaml documentation are a simplification: following
them will not result in unsafe code, but they describe a conservative
approximation of what code is safe. Instead of following the rules in the OCaml
documentation, the LLVM bindings follow more specific rules that are based on
an understanding of how the OCaml runtime works. For example, even though the
OCaml documentation instructs that all parameters be registered with the
`CAMLparam` macros, the bindings frequently don't do this. `CAMLparam`
registers a value as a GC root, but unboxed data such as `int`s don't need to
be roots, and even boxed data such as `string`s don't need to be registered if
the function won't trigger the GC, so in these cases, the bindings can skip the
macros.

Not all of the reasons why the bindings were using the OCaml runtime API safely
were obvious to me. The bindings contained the following helper function:

```cpp
value caml_alloc_tuple_uninit(mlsize_t wosize) {
  if (wosize <= Max_young_wosize) {
    return caml_alloc_small(wosize, 0);
  } else {
    return caml_alloc_shr(wosize, 0);
  }
}
```

`caml_alloc_small` allocates from the OCaml minor heap while `caml_alloc_shr`
allocates from the OCaml major heap. The OCaml documentation [states](
https://v2.ocaml.org/manual/intfc.html#sss:c-low-level-alloc) that
blocks allocated with `caml_alloc_small` should be initialized with a direct
assignment to the fields while blocks allocated with `caml_alloc_shr` should be
initialized with `caml_initialize`. However, the LLVM code initialized all
allocations returned from its `caml_alloc_tuple_init` helper function with
direct assignment regardless of which branch of the `if` statement was taken. I
didn't think the code was safe, but it was: Josh Berdine explained to me that
the purpose of `caml_initialize` is to notify the GC if the major heap
allocation contains fields that point to the minor heap, but none of the
field initializations in question were to the minor heap anyway.

Maintaining the bindings require an understanding of the OCaml runtime to
a level that currently isn't reflected in documentation, but instead relies
on institutional knowledge imparted by past contributors. Since the
intersection of people knowledgable about LLVM and OCaml is small,
institutional knowledge can fade as people come and go. Resources such as
[*Real World OCaml*](https://dev.realworldocaml.org/toc.html#scrollNav-3) have
in-depth documentation of the OCaml runtime, dicussing aspects such as the
workings of the garbage collector that the OCaml official documentation does
not cover. However, *Real World OCaml* predates OCaml 5, and the new parallel
runtime deserves a fresh effort at documentation as the new parallel features
make interopability between C and OCaml even trickier to get right. While
information about the new runtime may be scattered across [research papers](
https://dl.acm.org/doi/10.1145/3453483.3454039), [code comments](
https://github.com/ocaml/ocaml/blob/c08807a3b575f870a23ddfdcf3bf45dc95f75cc5/runtime/caml/fiber.h#L141),
and [blog posts](
https://kcsrk.info/multicore/gc/2017/07/06/multicore-ocaml-gc/), thoroughly
documenting the runtime in one place would benefit all projects that use the
OCaml FFI. In the future, [research](
https://www.ccs.neu.edu/home/amal/papers/seminterop.pdf) into verification of
FFI code may lead to tooling that can check the OCaml bindings to LLVM, but for
now, thorough testing and careful review is all we can do to ensure that the
code is correct.

Code review takes place on [LLVM's Phabricator instance](
https://reviews.llvm.org/) and uses a workflow that I was unfamiliar with but
eventually adapted to. The workflow which I was used to from GitHub projects
was to make a feature branch and push commits to the branch as I updated my
work. In contrast, the LLVM workflow uses `git commit --amend` for updating
work and uses stacked diffs for separating large changes into logical pieces
for separate review. However, I didn't need to learn how to use stacked diffs
to make my changes. As a matter of fact, LLVM is migrating to GitHub because
Phabricator is no longer maintained, prompting a [discussion](
https://discourse.llvm.org/t/code-review-process-update/63964) about whether
GitHub can support the LLVM workflow. Chris Lattner [encouraged](
https://discourse.llvm.org/t/code-review-process-update/63964/10) people to
speak up to their organization if it relied on LLVM and could be sponsoring a
code review solution. I don't belong to any organizations that can provide
LLVM with tools, so the most I can do is bring attention to this issue.

Finally, while my patches help the bindings remain usable with new versions of
LLVM and OCaml, the bindings still have several opportunities for future
contributions. First, they should now be usable in OCaml 5 sequential code, but
the bindings have yet to be checked for safety in OCaml 5 parallel code.
Second, LLVM is [switching](
https://blog.llvm.org/posts/2021-03-26-the-new-pass-manager/) from the legacy
pass manager to the new pass manager, and though I've removed the bindings for
the legacy pass manager, bindings for the new pass manager have yet to
be added. If you're interested in both LLVM and OCaml, I encourage you to
contribute and hope my experience helps you.

*Special thanks to [@2over12](https://github.com/2over12) for feedback on this
post.*
