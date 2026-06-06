<?php get_header(); ?>

<main class="max-w-3xl mx-auto px-4 py-10">
  <?php while (have_posts()) : the_post(); ?>
    <article class="bg-white rounded-2xl border border-slate-100 p-8 shadow-sm">
      <h1 class="text-2xl font-black text-slate-900 mb-6"><?php the_title(); ?></h1>
      <div class="prose prose-slate max-w-none text-sm text-slate-600 leading-relaxed">
        <?php the_content(); ?>
      </div>
    </article>
  <?php endwhile; ?>
</main>

<?php get_footer(); ?>
